/**
 * AI Referrals: the persisted referral projection for one project.
 *
 * Shared reader for API and Agent tools. It serves a persisted snapshot or the
 * empty payload, never a recomputation, and reports the window it actually
 * resolved rather than the one requested.
 */
import { aiReferralSourceRowSchema, aiReferralsSchema } from '@citeladder/contracts/ai-traffic';
import { sql } from 'kysely';
import { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { isoDateText } from '../db/timestamps.ts';
import { metricSeriesPoints } from './metric-series.ts';
import { record } from '../db/json.ts';
import { firstOf } from '../lists.ts';

const analytics = policy.analytics;
const PRESET_DAYS: Readonly<Record<string, number>> = analytics.preset_range_days;
const DAY_MS = 86_400_000;

/** An invalid granularity, range or window: the route answers 422. */
export class AiReferralsQueryError extends Error {}

export type AiReferralsResponse = z.infer<typeof aiReferralsSchema>;
const granularitySchema = aiReferralsSchema.shape.granularity;

export type AiReferralsQuery = {
  workspaceId: string;
  projectId: string;
  /** `YYYY-MM-DD`, as the date parameters parse. */
  fromDate: string | null;
  toDate: string | null;
  rangeToken: string | null;
  granularity: string;
};

function validateGranularity(value: string): string {
  const granularity = value || analytics.default_granularity;
  if (!analytics.snapshot_granularities.includes(granularity)) {
    throw new AiReferralsQueryError(`unknown granularity: ${granularity}`);
  }
  return granularity;
}

function validateRange(value: string | null): void {
  if (value !== null && !Object.hasOwn(PRESET_DAYS, value)) {
    throw new AiReferralsQueryError(`unknown ai-referrals range: ${value}`);
  }
}

function validateWindow(fromDate: string | null, toDate: string | null): void {
  if ((fromDate === null) !== (toDate === null)) {
    throw new AiReferralsQueryError("'from' and 'to' must be supplied together");
  }
  if (fromDate === null || toDate === null) return;
  if (toDate < fromDate) throw new AiReferralsQueryError("'to' must not be before 'from'");
  const days = (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / DAY_MS;
  if (days + 1 > analytics.max_window_days) {
    throw new AiReferralsQueryError(
      `window exceeds ANALYTICS_MAX_WINDOW_DAYS (${analytics.max_window_days})`,
    );
  }
}

/** Stored counts must be exact integers; missing is not observed zero. */
const sessionCount = z
  .union([z.number(), z.string().trim().min(1)])
  .pipe(z.coerce.number<string | number>().int().nonnegative().max(Number.MAX_SAFE_INTEGER));

function laxShare(value: unknown): number | null {
  return firstOf(metricSeriesPoints([{ value }]), 'the series point built for one value').value;
}

/** `ai_referral_sources`: the stored per-source rows as served; a malformed value is a 500. */
export function aiReferralSources(raw: unknown) {
  const rows: unknown[] = Array.isArray(raw) ? raw : [];
  return rows.filter(isObject).map((row) => ({
    ai_source: aiReferralSourceRowSchema.shape.ai_source.parse(row.ai_source),
    sessions: sessionCount.parse(row.sessions),
    share: laxShare(row.share),
  }));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function readAiReferrals(
  db: Database,
  query: AiReferralsQuery,
): Promise<{ snapshotId: string | null; response: AiReferralsResponse }> {
  const granularity = validateGranularity(query.granularity);
  validateRange(query.rangeToken);
  validateWindow(query.fromDate, query.toDate);
  let snapshots = db
    .selectFrom('ai_referrals_snapshots')
    .select([
      'id',
      'granularity',
      'metrics',
      'analyzer_version',
      'formula_version',
      isoDateText(sql.ref('window_start')).as('window_start'),
      isoDateText(sql.ref('window_end')).as('window_end'),
    ])
    .where('workspace_id', '=', query.workspaceId)
    .where('project_id', '=', query.projectId)
    .where('granularity', '=', granularity)
    .where('analyzer_version', '=', analytics.ai_referral_analyzer_version)
    .where('formula_version', '=', analytics.ai_referral_formula_version);
  if (query.rangeToken !== null) {
    // The preset marker, not the window's length: a sync window can happen to
    // be exactly 30 days long without being "Last 30 days".
    snapshots = snapshots
      .where('preset_window_days', '=', PRESET_DAYS[query.rangeToken]!)
      .orderBy('window_end', 'desc')
      .orderBy('window_start', 'desc');
  } else if (query.fromDate !== null && query.toDate !== null) {
    snapshots = snapshots
      .where('window_start', '=', sql<Date>`${query.fromDate}::date`)
      .where('window_end', '=', sql<Date>`${query.toDate}::date`);
  } else {
    snapshots = snapshots.orderBy('window_end', 'desc').orderBy('window_start', 'desc');
  }
  const snapshot = await snapshots.limit(1).executeTakeFirst();
  const versions = {
    analyzer_version: analytics.ai_referral_analyzer_version,
    formula_version: analytics.ai_referral_formula_version,
  };
  if (snapshot === undefined) {
    return {
      snapshotId: null,
      response: aiReferralsSchema.parse({
        project_id: query.projectId,
        window_start: query.fromDate ?? '',
        window_end: query.toDate ?? '',
        granularity: granularitySchema.parse(granularity),
        referral_volume: [],
        referral_share: [],
        sources: [],
        ...versions,
      }),
    };
  }
  if (snapshot.metrics != null && !isObject(snapshot.metrics)) {
    throw new TypeError('stored metrics are not an object');
  }
  const metrics = isObject(snapshot.metrics) ? snapshot.metrics : {};
  return {
    snapshotId: snapshot.id,
    response: {
      project_id: query.projectId,
      window_start: snapshot.window_start,
      window_end: snapshot.window_end,
      granularity: granularitySchema.parse(snapshot.granularity),
      referral_volume: metricSeriesPoints(metrics.referral_volume),
      referral_share: metricSeriesPoints(metrics.referral_share),
      sources: aiReferralSources(metrics.sources),
      analyzer_version: snapshot.analyzer_version,
      formula_version: snapshot.formula_version,
      scope: 'property-wide',
      reporting_timezone:
        typeof metrics.reporting_timezone === 'string' ? metrics.reporting_timezone : null,
      currency_code: typeof metrics.currency_code === 'string' ? metrics.currency_code : null,
      analytics_quality: aiReferralsSchema.shape.analytics_quality.parse(metrics.analytics_quality),
      unattributed_landing: aiReferralsSchema.shape.unattributed_landing.parse(
        metrics.unattributed_landing,
      ),
      source_measures: aiReferralsSchema.shape.source_measures.parse(metrics.source_measures),
      channel_comparison: aiReferralsSchema.shape.channel_comparison.parse(
        metrics.channel_comparison,
      ),
      landing_pages: aiReferralsSchema.shape.landing_pages.parse(landingSummary(metrics.landing)),
    },
  };
}

function landingSummary(raw: unknown) {
  const groups = new Map<
    string,
    {
      url_hash: string;
      canonical_url: string;
      ai_source: string;
      sessions: number;
      key_events: number;
      analytics_quality: string[];
    }
  >();
  for (const value of Array.isArray(raw) ? raw : []) {
    const r = record(value),
      key = String(r.url_hash) + ':' + String(r.ai_source);
    const row = groups.get(key) ?? {
      url_hash: String(r.url_hash),
      canonical_url: String(r.canonical_url),
      ai_source: String(r.ai_source),
      sessions: 0,
      key_events: 0,
      analytics_quality: [],
    };
    row.sessions += Number(r.sessions);
    row.key_events += Number(r.key_events);
    row.analytics_quality = [
      ...new Set([
        ...row.analytics_quality,
        ...(Array.isArray(r.analytics_quality) ? (r.analytics_quality as string[]) : []),
      ]),
    ];
    groups.set(key, row);
  }
  return [...groups.values()].map((r) => ({
    ...r,
    sessions: r.sessions === 0 && r.analytics_quality.length ? null : r.sessions,
    key_events: r.key_events === 0 && r.analytics_quality.length ? null : r.key_events,
  }));
}

export async function getAiReferrals(
  db: Database,
  query: AiReferralsQuery,
): Promise<AiReferralsResponse> {
  return (await readAiReferrals(db, query)).response;
}
