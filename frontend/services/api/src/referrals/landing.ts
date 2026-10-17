/** Landing and property-wide comparison projections share the existing referral refresh. */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { isoDateText } from '../db/timestamps.ts';
import {
  selectedPartition,
  partitionQuality,
  type PartitionScope,
} from '../integrations/partitions.ts';
import { projectHosts, landingPage } from '../integrations/host-scope.ts';
import { classifyReferralSignals } from './classification.ts';
import { hash } from '../traffic/normalization.ts';
import { aiTraffic } from '../config/ai-traffic.ts';
import { pathIdentity } from '../crawl-logs/identity.ts';
import { policy } from '../config.ts';
import { compareText } from '../text-order.ts';
import { isNonEmpty, lastOf, type NonEmpty } from '../lists.ts';

const datasets = [
  'ga4_landing_daily',
  'ga4_source_medium_daily',
  'ga4_channel_daily',
  'ga4_ecommerce_source_medium_daily',
];
const arities = Object.fromEntries(
  Object.entries(policy.integrations.datasets).map(([name, dataset]) => [
    name,
    dataset.dimensions.length,
  ]),
);
export async function referralEvidence(db: Database, scope: PartitionScope) {
  const query = () =>
    db
      .selectFrom('integration_metric_rows')
      .selectAll()
      .select(isoDateText(sql.ref('date')).as('day'))
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('dataset', 'in', datasets)
      .where('date', '>=', sql<Date>`${scope.start}::date`)
      .where('date', '<=', sql<Date>`${scope.end}::date`)
      .where(selectedPartition())
      .orderBy('id')
      .limit(policy.traffic.TRAFFIC_METRIC_ROW_BATCH_SIZE);
  const rows: Awaited<ReturnType<ReturnType<typeof query>['execute']>> = [];
  let after: string | null = null;
  for (;;) {
    const batch = await (after ? query().where('id', '>', after) : query()).execute();
    rows.push(...batch);
    if (batch.length < policy.traffic.TRAFFIC_METRIC_ROW_BATCH_SIZE || !isNonEmpty(batch)) break;
    after = lastOf(batch).id;
  }
  const qualities = await Promise.all(
    datasets.map(async (dataset) => [dataset, await partitionQuality(db, scope, dataset)] as const),
  );
  return {
    rows,
    quality: Object.fromEntries(qualities),
    hosts: await projectHosts(db, scope.workspaceId, scope.projectId),
  };
}
type Evidence = Awaited<ReturnType<typeof referralEvidence>>;
const count = (m: Record<string, unknown>, key: string) =>
  typeof m[key] === 'number' && Number.isFinite(m[key]) ? (m[key] as number) : 0;
const signals = (parts: readonly string[]) =>
  classifyReferralSignals({ utm_source: parts[0], utm_medium: parts[1] });
type Counts = { sessions: number; engaged_sessions: number; key_events: number };
const empty = (): Counts => ({ sessions: 0, engaged_sessions: 0, key_events: 0 });
function add(target: Counts, m: Record<string, unknown>) {
  target.sessions += count(m, 'sessions');
  target.engaged_sessions += count(m, 'engagedSessions');
  target.key_events += count(m, 'keyEvents');
}
function dimensionParts(row: Evidence['rows'][number]): NonEmpty<string> {
  const split = row.dimension_key.split(policy.integrations.dimension_separator);
  const arity = arities[row.dataset]!;
  return [
    split.slice(0, split.length - arity + 1).join(policy.integrations.dimension_separator),
    ...split.slice(split.length - arity + 1),
  ];
}
function landingExtras(rows: Evidence['rows'], evidence: Evidence) {
  let unattributed = 0;
  const landing = new Map<
    string,
    Counts & {
      url_hash: string;
      canonical_url: string;
      display_path: string;
      folder: string;
      resource_class: string;
      ai_source: string;
      reporting_date: string;
      reporting_timezone: string;
      analytics_quality: string[];
      source_metric_row_ids: string[];
    }
  >();
  for (const row of rows) {
    if (row.dataset !== 'ga4_landing_daily') continue;
    const parts = dimensionParts(row),
      m = record(row.metrics);
    const match = signals(parts.slice(1, 3));
    if (!match) continue;
    const quality = evidence.quality[row.dataset]!.find((q) => q.day === row.day)!;
    const host = parts.at(-2);
    if (host === undefined) throw new Error('Expected a host dimension on a landing row');
    const page = landingPage(parts[0], host, evidence.hosts);
    if (!page) {
      if (evidence.hosts.has(host.toLowerCase())) unattributed += count(m, 'sessions');
      continue;
    }
    const tz = quality.reporting_timezone ?? 'unknown',
      urlHash = hash(page),
      key = [row.day, tz, urlHash, match.ai_source].join(':');
    const identity = pathIdentity(page, new URL(page).origin)!;
    const item = landing.get(key) ?? {
      ...empty(),
      url_hash: urlHash,
      canonical_url: page,
      display_path: identity.display_path,
      folder: identity.folder,
      resource_class: identity.resource_class,
      ai_source: match.ai_source,
      reporting_date: row.day,
      reporting_timezone: tz,
      analytics_quality: quality.flags,
      source_metric_row_ids: [],
    };
    add(item, m);
    item.source_metric_row_ids.push(row.id);
    landing.set(key, item);
  }
  return { landing: [...landing.values()], unattributed };
}
function sourceExtras(rows: Evidence['rows']) {
  const sources = new Map<string, Counts & { transactions: number; purchase_revenue: number }>();
  const channels = { ai: empty(), organic: empty(), total: empty() };
  for (const row of rows) {
    if (row.dataset === 'ga4_landing_daily') continue;
    const parts = dimensionParts(row),
      m = record(row.metrics);
    if (row.dataset === 'ga4_channel_daily') {
      add(channels.total, m);
      if (parts[0] === 'Organic Search') add(channels.organic, m);
      continue;
    }
    const match = signals(parts);
    if (!match) continue;
    const source = sources.get(match.ai_source) ?? {
      ...empty(),
      transactions: 0,
      purchase_revenue: 0,
    };
    if (row.dataset === 'ga4_source_medium_daily') {
      add(source, m);
      add(channels.ai, m);
    } else {
      source.transactions += count(m, 'transactions');
      source.purchase_revenue += count(m, 'purchaseRevenue');
    }
    sources.set(match.ai_source, source);
  }
  return { sources, channels };
}
export function referralExtras(evidence: Evidence, start: string, end: string) {
  const rows = evidence.rows.filter((r) => r.day >= start && r.day <= end);
  const { landing, unattributed } = landingExtras(rows, evidence);
  const { sources, channels } = sourceExtras(rows);
  const quality = Object.fromEntries(
    Object.entries(evidence.quality).map(([dataset, q]) => [
      dataset,
      q.filter((d) => d.day >= start && d.day <= end),
    ]),
  );
  const usable = (dataset: string) =>
    quality[dataset]!.every((q) => q.revision !== null && q.flags.length === 0);
  const measure = (counts: Counts, valid: boolean) => ({
    sessions: counts.sessions >= 0 && (valid || counts.sessions > 0) ? counts.sessions : null,
    key_events:
      counts.key_events >= 0 && (valid || counts.key_events > 0) ? counts.key_events : null,
    engagement_rate:
      valid && counts.sessions > 0 ? counts.engaged_sessions / counts.sessions : null,
  });
  const channelValid = usable('ga4_channel_daily') && usable('ga4_source_medium_daily');
  const other = {
    sessions: channels.total.sessions - channels.ai.sessions - channels.organic.sessions,
    engaged_sessions:
      channels.total.engaged_sessions -
      channels.ai.engaged_sessions -
      channels.organic.engaged_sessions,
    key_events: channels.total.key_events - channels.ai.key_events - channels.organic.key_events,
  };
  const currencies = [
    ...new Set(
      quality.ga4_ecommerce_source_medium_daily!.map((q) => q.currency_code).filter(Boolean),
    ),
  ];
  return {
    landing,
    unattributed_landing: usable('ga4_landing_daily') || unattributed > 0 ? unattributed : null,
    analytics_quality: quality,
    scope: 'property-wide',
    reporting_timezone:
      quality.ga4_source_medium_daily!.find((q) => q.reporting_timezone)?.reporting_timezone ??
      null,
    currency_code: currencies.length === 1 ? currencies[0] : null,
    source_measures: [...sources].map(([ai_source, s]) => ({
      ai_source,
      ...measure(s, usable('ga4_source_medium_daily')),
      transactions: usable('ga4_ecommerce_source_medium_daily') ? s.transactions : null,
      purchase_revenue:
        currencies.length === 1 && usable('ga4_ecommerce_source_medium_daily')
          ? s.purchase_revenue
          : null,
    })),
    channel_comparison: [
      { channel: 'AI referrals', ...measure(channels.ai, channelValid) },
      { channel: 'Organic Search', ...measure(channels.organic, channelValid) },
      {
        channel: 'All other sessions',
        ...(Object.values(other).every((v) => v >= 0)
          ? measure(other, channelValid)
          : { sessions: null, key_events: null, engagement_rate: null }),
      },
    ],
    source_metric_row_count: rows.length,
    source_artifact_ids: [...new Set(rows.map((r) => r.source_artifact_id))]
      .sort(compareText)
      .slice(0, policy.traffic.TRAFFIC_PROVENANCE_ID_LIMIT),
  };
}
export async function replaceReferralLandings(
  db: Database,
  scope: PartitionScope,
  extras: ReturnType<typeof referralExtras>,
) {
  await db
    .deleteFrom('ai_referral_landing_daily')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('reporting_date', '>=', sql<Date>`${scope.start}::date`)
    .where('reporting_date', '<=', sql<Date>`${scope.end}::date`)
    .execute();
  for (let i = 0; i < extras.landing.length; i += policy.traffic.TRAFFIC_METRIC_ROW_BATCH_SIZE) {
    // Chunks stay under the bind-parameter limit on one connection.
    await db // NOSONAR
      .insertInto('ai_referral_landing_daily')
      .values(
        extras.landing.slice(i, i + policy.traffic.TRAFFIC_METRIC_ROW_BATCH_SIZE).map((r) => ({
          ...r,
          id: randomUUID(),
          workspace_id: scope.workspaceId,
          project_id: scope.projectId,
          analytics_quality: JSON.stringify(r.analytics_quality),
          source_metric_row_ids: JSON.stringify(r.source_metric_row_ids),
          formula_version: aiTraffic.formula_version,
        })),
      )
      .execute();
  }
}
