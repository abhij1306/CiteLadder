/**
 * Ads in AI answers: the selection summary and one execution's ads.
 *
 * Projections over persisted `answer_ad_observations` and the
 * `response_analyses.ads_parser_version` marker; nothing is parsed, fetched
 * or repaired here. Ads never reach citations, mentions or scores.
 */
import {
  adOwnershipSchema,
  type ExecutionAds,
  type VisibilityAdsResponse,
} from '@citeladder/contracts/visibility-ads';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { utcTextOf, wireUtc } from '../db/timestamps.ts';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../http/keyset-cursor.ts';
import { groupBy } from '../lists.ts';
import { compareText } from '../text-order.ts';
import { adsSummary, creativeOrder, type AdAnswer } from './ad-metrics.ts';
import { scopedSelection } from './dashboard.ts';
import { evidenceScope, observedAt, type RunSelection } from './selection.ts';

const CREATIVES_CURSOR_SCOPE = 'visibility.ads.creatives';
const adsEngine = policy.audits.ads_engine;

const AD_COLUMNS = [
  'ad.rank_absolute',
  'ad.advertiser_name',
  'ad.advertiser_domain',
  'ad.ownership',
  'ad.title',
  'ad.snippet',
] as const;

/** A persisted ad with its ownership parsed at the read boundary. */
function observation<Row extends { ownership: string }>(row: Row) {
  return { ...row, ownership: adOwnershipSchema.parse(row.ownership) };
}

async function selectionAnswers(db: Database, selection: RunSelection) {
  const scoped = await scopedSelection(db, selection);
  const scope = () =>
    evidenceScope(db, scoped).where('audit.audit_scope', '=', policy.visibility.brand_audit_scope);
  // Each answer's ads at its own parser version, joined in SQL.
  const [rows, ads] = await Promise.all([
    scope()
      .select([
        'ra.audit_id',
        'ra.artifact_id',
        'ra.logical_engine',
        'ra.ads_parser_version',
        'ra.brand_mentioned',
        'snapshot.text as prompt',
        'snapshot.theme as topic',
        utcTextOf(observedAt).as('observed_at'),
      ])
      .execute(),
    scope()
      .innerJoin('answer_ad_observations as ad', (join) =>
        join
          .onRef('ad.artifact_id', '=', 'ra.artifact_id')
          .onRef('ad.parser_version', '=', 'ra.ads_parser_version'),
      )
      .where('ad.workspace_id', '=', scoped.workspaceId)
      .where('ad.project_id', '=', scoped.projectId)
      .select(['ra.artifact_id', ...AD_COLUMNS, 'ad.landing_url_canonical'])
      .orderBy('ad.rank_absolute')
      .execute(),
  ]);
  const byArtifact = groupBy(ads.map(observation), (row) => row.artifact_id);
  const answers = rows.map((row): AdAnswer => ({
    auditId: row.audit_id,
    observedAt: wireUtc(row.observed_at),
    engine: row.logical_engine,
    prompt: row.prompt,
    topic: row.topic || 'Untagged',
    adsParserVersion: row.ads_parser_version,
    brandMentioned: row.brand_mentioned,
    ads: byArtifact.get(row.artifact_id) ?? [],
  }));
  return { answers, auditIds: [...new Set(rows.map((row) => row.audit_id))].sort(compareText) };
}

function cursorPosition(cursor: string, fingerprint: Record<string, unknown>) {
  const [appearances, last_seen_at, key] = decodeKeysetCursor(
    cursor,
    CREATIVES_CURSOR_SCOPE,
    fingerprint,
  );
  const count = Number(appearances);
  if (last_seen_at === undefined || key === undefined || !Number.isSafeInteger(count))
    throw new InvalidCursorError('invalid cursor');
  return { appearances: count, last_seen_at, key };
}

export async function getAds(
  db: Database,
  selection: RunSelection,
  page: { cursor: string | null; limit: number },
): Promise<VisibilityAdsResponse> {
  const fingerprint = { selection: JSON.stringify(selection) };
  const after = page.cursor ? cursorPosition(page.cursor, fingerprint) : null;
  const { answers, auditIds } = await selectionAnswers(db, selection);
  const summary = adsSummary(answers, {
    adsEngine,
    engineFilter: selection.logicalEngine,
    metricsVersion: policy.audits.ads_versions.metrics_version,
    advertisersLimit: policy.visibility.ads_advertisers_limit,
  });
  const remaining = after
    ? summary.creatives.filter((creative) => creativeOrder(creative, after) > 0)
    : summary.creatives;
  const items = remaining.slice(0, page.limit);
  const last = items.at(-1);
  return {
    ...summary,
    source_audit_ids: auditIds,
    creatives: {
      items: items.map(({ key: _key, ...creative }) => creative),
      total: summary.creatives.length,
      next_cursor:
        last && remaining.length > page.limit
          ? encodeKeysetCursor(CREATIVES_CURSOR_SCOPE, fingerprint, [
              String(last.appearances),
              last.last_seen_at,
              last.key,
            ])
          : null,
    },
  };
}

/** One execution's ads at its own parser version, apart from its sources. */
export async function executionAds(
  db: Database,
  input: {
    workspaceId: string;
    artifactId: string;
    logicalEngine: string;
    adsParserVersion: string | null;
  },
): Promise<ExecutionAds> {
  if (input.logicalEngine !== adsEngine)
    return { applicability: 'not_applicable', parser_version: null, items: [] };
  if (!input.adsParserVersion)
    return { applicability: 'unavailable', parser_version: null, items: [] };
  const rows = await db
    .selectFrom('answer_ad_observations as ad')
    .select([...AD_COLUMNS, 'ad.landing_url_canonical as landing_url'])
    .where('ad.workspace_id', '=', input.workspaceId)
    .where('ad.artifact_id', '=', input.artifactId)
    .where('ad.parser_version', '=', input.adsParserVersion)
    .orderBy('ad.rank_absolute')
    .execute();
  return {
    applicability: 'applicable',
    parser_version: input.adsParserVersion,
    items: rows.map(observation),
  };
}
