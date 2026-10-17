/** Conservative crawl coverage from saved discovery state; never acquisition on a read. */
import { sql } from 'kysely';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { compareText } from '../text-order.ts';
import type { Crawl } from './task-fence.ts';

export type CoverageSignals = {
  sampleMode: boolean;
  inputMode: string;
  cancelled: boolean;
  discoveryStatus: string;
  requestedPageLimit: number;
  frontierLimit: number;
  admittedUrlCount: number;
  observationCount: number;
  pendingFrontierCount: number;
  discoveryTaskCount: number;
  failedDiscoveryTaskCount: number;
  analyzedUrlCount: number;
  failedUrlCount: number;
  /** This crawl's automatic analysis allowance (the plan's monitored pages); null when none was recorded. */
  automaticLimit: number | null;
  /** Found and analyzed URLs per admission value tier; empty when nothing went through the frontier. */
  valueKinds?: ValueKindCoverage[];
};
export type ValueKindCoverage = { kind: string; found: number; analyzed: number };

const BOUNDED_DISCOVERY = new Set(['cancelled', 'sample_completed', 'stopped']);

/** A limit, a pending frontier or an explicit bound cut discovery short. */
function partialReasons(signals: CoverageSignals) {
  const reasons: string[] = [];
  if (signals.requestedPageLimit > 0 && signals.admittedUrlCount >= signals.requestedPageLimit)
    reasons.push('requested_page_limit_reached');
  if (signals.frontierLimit > 0 && signals.admittedUrlCount >= signals.frontierLimit)
    reasons.push('frontier_limit_reached');
  if (signals.pendingFrontierCount > 0) reasons.push('frontier_not_exhausted');
  const bounded =
    signals.sampleMode ||
    signals.inputMode !== 'auto' ||
    signals.cancelled ||
    BOUNDED_DISCOVERY.has(signals.discoveryStatus) ||
    !signals.discoveryTaskCount;
  if (bounded) reasons.push('discovery_bounded_or_stopped');
  return reasons;
}

/** Discovery that failed, observed nothing or never completed proves nothing about coverage. */
function unknownReasons(signals: CoverageSignals) {
  const reasons: string[] = [];
  if (signals.failedDiscoveryTaskCount) reasons.push('discovery_failed');
  if (!signals.observationCount) reasons.push('no_observed_urls');
  if (signals.discoveryStatus !== 'completed') reasons.push('discovery_not_completed');
  return reasons;
}

/**
 * The safest state the frozen facts support: `partial` when discovery was cut
 * short, `unknown` when it failed or never completed, and `complete` only for
 * an exhausted frontier.
 */
export function assessCoverage(signals: CoverageSignals) {
  const partial = partialReasons(signals);
  const unknown = partial.length ? [] : unknownReasons(signals);
  let state = 'complete';
  if (partial.length) state = 'partial';
  else if (unknown.length) state = 'unknown';
  const reasons = state === 'complete' ? ['frontier_exhausted'] : [...partial, ...unknown];
  return {
    state,
    evidence: {
      reasons,
      requested_page_limit: signals.requestedPageLimit,
      frontier_limit: signals.frontierLimit,
      admitted_url_count: signals.admittedUrlCount,
      observation_count: signals.observationCount,
      pending_frontier_count: signals.pendingFrontierCount,
      discovery_task_count: signals.discoveryTaskCount,
      failed_discovery_task_count: signals.failedDiscoveryTaskCount,
      analyzed_url_count: signals.analyzedUrlCount,
      failed_url_count: signals.failedUrlCount,
      automatic_limit: signals.automaticLimit,
      value_kinds: signals.valueKinds ?? [],
    },
  };
}

/** The crawl's frozen allowance, or null when none was recorded (never a silent zero). */
function allowance(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const limit = Number(value);
  return Number.isFinite(limit) && limit >= 0 ? limit : null;
}

const PRIORITIES: Record<string, number> = policy.site_health.crawl.value_priorities;
const EXPECTED_KINDS: readonly string[] = policy.site_health.crawl.coverage_expected_value_kinds;

/**
 * "Kind not found" apart from "found but not analyzed": the crawl's frontier by
 * value tier, with the expected tiers it never found as zero. A crawl that
 * admitted nothing through the frontier (a sample) has no funnel to report.
 */
export async function valueKindCoverage(db: Database, crawl: Crawl): Promise<ValueKindCoverage[]> {
  const rows = await db
    .selectFrom('site_discovery_frontier as f')
    .leftJoin('site_urls as u', (join) =>
      join
        .onRef('u.url_hash', '=', 'f.url_hash')
        .onRef('u.workspace_id', '=', 'f.workspace_id')
        .on('u.project_id', '=', crawl.project_id),
    )
    .leftJoin('site_page_analyses as a', (join) =>
      join
        .onRef('a.site_url_id', '=', 'u.id')
        .onRef('a.workspace_id', '=', 'u.workspace_id')
        .on('a.crawl_id', '=', crawl.id)
        .on('a.is_current', '=', true),
    )
    .select([
      'f.value_kind as kind',
      sql<number>`count(distinct f.url_hash)::int`.as('found'),
      sql<number>`count(distinct a.site_url_id)::int`.as('analyzed'),
    ])
    .where('f.workspace_id', '=', crawl.workspace_id)
    .where('f.crawl_id', '=', crawl.id)
    .groupBy('f.value_kind')
    .execute();
  if (!rows.length) return [];
  const seen = new Set(rows.map((row) => row.kind));
  return [
    ...rows,
    ...EXPECTED_KINDS.filter((kind) => !seen.has(kind)).map((kind) => ({
      kind,
      found: 0,
      analyzed: 0,
    })),
  ].toSorted(
    (a, b) => (PRIORITIES[b.kind] ?? 0) - (PRIORITIES[a.kind] ?? 0) || compareText(a.kind, b.kind),
  );
}

export async function crawlCoverage(db: Database, crawl: Crawl) {
  const discovery = await db
    .selectFrom('site_crawl_tasks')
    .select([
      sql<number>`count(*)::int`.as('total'),
      sql<number>`count(*) filter (where status = 'failed')::int`.as('failed'),
    ])
    .where('workspace_id', '=', crawl.workspace_id)
    .where('crawl_id', '=', crawl.id)
    .where('task_kind', '=', 'discover')
    .executeTakeFirstOrThrow();
  const frontier = await db
    .selectFrom('site_discovery_frontier')
    .select(sql<number>`count(*)::int`.as('count'))
    .where('workspace_id', '=', crawl.workspace_id)
    .where('crawl_id', '=', crawl.id)
    .where('status', '=', 'pending')
    .executeTakeFirstOrThrow();
  const observations = await db
    .selectFrom('site_url_observations')
    .select(sql<number>`count(*)::int`.as('count'))
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('crawl_id', '=', crawl.id)
    .executeTakeFirstOrThrow();
  const config = record(crawl.configuration);
  return assessCoverage({
    sampleMode: crawl.sample_mode,
    inputMode:
      typeof config.input_mode === 'string' && config.input_mode ? config.input_mode : 'auto',
    cancelled: crawl.status === 'cancelled',
    discoveryStatus: crawl.discovery_status,
    requestedPageLimit: Number(crawl.discovery_requested_count || config.requested_page_limit || 0),
    frontierLimit: Number(config.max_frontier_urls || 0),
    admittedUrlCount: crawl.admitted_url_count,
    observationCount: observations.count,
    pendingFrontierCount: frontier.count,
    discoveryTaskCount: discovery.total,
    failedDiscoveryTaskCount: discovery.failed,
    analyzedUrlCount: crawl.analyzed_url_count,
    failedUrlCount: crawl.failed_url_count,
    automaticLimit: allowance(config[policy.site_health.crawl.automatic_monitor_limit_key]),
    valueKinds: await valueKindCoverage(db, crawl),
  });
}
