import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { aiTrafficInsightsSchema } from '@citeladder/contracts/ai-traffic';
import type { z } from 'zod';
import type { Database } from '../db/database.ts';
import type { CrawlScope } from './state.ts';
import {
  crawlWindow,
  currentReportingDay,
  withReportingTimezone,
  type CrawlReadOptions,
} from './reads.ts';
import { partitionAnchor } from '../integrations/partitions.ts';
import { addDays } from '../referrals/projection.ts';
import { pageDataset, type JoinedPage } from './pages-data.ts';
import { ga4Mapped, insightSnapshot, pageContext, pageComparable } from './pages.ts';
import { aiTraffic } from '../config/ai-traffic.ts';
import { policy } from '../config.ts';
import { strings, record, numberRecord } from '../db/json.ts';
import { taskProject, type Executor } from '../workers/executor.ts';

type Pattern = z.infer<typeof aiTrafficInsightsSchema>['patterns'][number];
function verifiedErrorCounts(rows: JoinedPage[]) {
  const codes: Record<string, number> = {};
  for (const row of rows)
    for (const [code, count] of Object.entries(numberRecord(row.verified_errors)))
      codes['status_' + code] = (codes['status_' + code] ?? 0) + count;
  return codes;
}
export function insightPatterns(
  rows: JoinedPage[],
  context: Awaited<ReturnType<typeof pageContext>>,
  bounded = false,
) {
  const patterns: Pattern[] = [],
    ga4 = context.ga4Complete;
  const crawl = context.crawlComplete;
  const compatible = rows.every((r) => pageComparable(r, context));
  const absenceReady = crawl && ga4 && compatible;
  const add = (
    pattern: Pattern['pattern'],
    items: JoinedPage[],
    copy: string,
    numbers: Pattern['numbers'],
  ) => {
    if (!items.length) return;
    patterns.push({
      pattern,
      url_hashes: items.slice(0, aiTraffic.max_pattern_pages).map((r) => r.url_hash),
      copy,
      numbers: { ...numbers, page_count: items.length },
      coverage: { crawl: context.crawl.coverage, ga4: ga4 ? 'complete' : 'incomplete' },
    });
  };
  if (absenceReady) {
    const absent = rows.filter(
      (r) =>
        (r.verified_requests ?? 0) >= aiTraffic.min_verified_requests && (r.sessions ?? 0) === 0,
    );
    add(
      'crawled_without_referrals',
      absent,
      'Verified AI requests and no identifiable AI referrals co-occurred in this window.',
      { requests: absent.reduce((s, r) => s + (r.verified_requests ?? 0), 0) },
    );
    const unseen = rows.filter(
      (r) => (r.sessions ?? 0) >= aiTraffic.min_referral_sessions && (r.ai_requests ?? 0) === 0,
    );
    add(
      'referrals_without_recent_crawl',
      unseen,
      'AI referrals co-occurred with no recognized AI requests in the complete available logs.',
      { sessions: unseen.reduce((s, r) => s + (r.sessions ?? 0), 0) },
    );
    const valuable = rows.filter(
      (r) =>
        Object.keys(record(r.verified_errors)).length > 0 &&
        ((r.sessions ?? 0) > 0 || (r.key_events ?? 0) > 0 || (r.citations ?? 0) > 0),
    );
    add(
      'crawler_errors_on_valuable_pages',
      valuable,
      'Verified crawler errors co-occurred on pages with tracked citations, AI referrals or key events.',
      verifiedErrorCounts(valuable),
    );
  }
  if (ga4 && compatible && !bounded) {
    const sorted = rows
      .filter((r) => (r.key_events ?? 0) > 0)
      .sort(
        (a, b) => (b.key_events ?? 0) - (a.key_events ?? 0) || a.url_hash.localeCompare(b.url_hash),
      );
    const total = sorted.reduce((s, r) => s + (r.key_events ?? 0), 0),
      top = sorted.slice(0, aiTraffic.concentration_top_k),
      events = top.reduce((s, r) => s + (r.key_events ?? 0), 0);
    if (total > 0 && events / total >= aiTraffic.concentration_share)
      add(
        'key_event_concentration',
        top,
        'AI-referral key events were concentrated on these pages in the same window.',
        { key_events: events, total_key_events: total, share: events / total },
      );
  }
  return patterns;
}
/** Each preset ends on the last closed reporting day that crawl logs and GA4 can both cover. */
async function insightWindows(db: Database, scope: CrawlScope, now = new Date()) {
  const options = await withReportingTimezone(db, scope, {});
  const closed = addDays(currentReportingDay(options, now), -1);
  const anchor = await partitionAnchor(db, scope.workspaceId, scope.projectId, 'ga4_landing_daily');
  const end = anchor && anchor < closed ? anchor : closed;
  return Object.values(policy.analytics.preset_range_days).map((days) => ({
    ...options,
    start_date: addDays(end, 1 - days),
    end_date: end,
  }));
}
export const refreshTrafficInsights: Executor = async (task, { db, checkCancelled }) => {
  const projectId = await taskProject(db, task),
    scope = { workspaceId: task.workspace_id, projectId };
  await db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${scope.workspaceId + ':' + projectId + ':ai-traffic-insights-publication'},0))`.execute(
      trx,
    );
    if (!(await ga4Mapped(trx, scope))) return;
    // Windows share one locked transaction; each checks cancellation first.
    for (const window of await insightWindows(trx, scope)) {
      await checkCancelled('AI Traffic insight window'); // NOSONAR
      await refreshInsightWindow(trx, scope, window); // NOSONAR
    }
  });
};
/** The worker's persisted derivation for one resolved window; called in its publication transaction. */
export async function refreshInsightWindow(
  db: Database,
  scope: CrawlScope,
  input: CrawlReadOptions,
) {
  const options = await withReportingTimezone(db, scope, input);
  const w = crawlWindow(options);
  const [data, context] = await Promise.all([
    pageDataset(db, scope, { ...options, dataset_limit: aiTraffic.max_timeline_items + 1 }),
    pageContext(db, scope, options),
  ]);
  const bounded = data.rows.length > aiTraffic.max_timeline_items;
  const rows = data.rows.slice(0, aiTraffic.max_timeline_items),
    patterns = insightPatterns(rows, context, bounded);
  let notice: string | null = null;
  if (!rows.every((r) => pageComparable(r, context)))
    notice = 'Reporting timezones are non-comparable. Patterns are unavailable.';
  else if (!context.crawlComplete || !context.ga4Complete)
    notice = 'Coverage is incomplete. Absence-based insights are unavailable.';
  else if (bounded) notice = 'Insights cover a bounded set of observed pages.';
  const coverage = {
    crawl: context.crawl.coverage,
    ga4_complete: context.ga4Complete,
    notice,
  };
  const provenance = {
    crawl_rollup_ids: rows.flatMap((r) => strings(r.crawl_ids)),
    landing_rollup_ids: rows.flatMap((r) => strings(r.landing_ids)),
    citation_ids: rows.flatMap((r) => strings(r.citation_ids)),
    audit_ids: [...new Set(rows.flatMap((r) => strings(r.audit_ids)))],
    crawl_id: data.crawl?.id ?? null,
    ga4_artifact_ids: context.quality.flatMap((q) => q.artifact_ids),
  };
  const content = {
    patterns: JSON.stringify(patterns),
    coverage: JSON.stringify(coverage),
    provenance: JSON.stringify(provenance),
    thresholds: JSON.stringify(aiTraffic),
    formula_version: aiTraffic.formula_version,
    created_at: new Date(),
  };
  await db
    .insertInto('ai_traffic_insights')
    .values({
      id: randomUUID(),
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      window_start: w.start,
      window_end: w.end,
      ...content,
    })
    .onConflict((c) => c.constraint('uq_ai_traffic_insights_window').doUpdateSet(content))
    .execute();
  // A newer window of the same length replaces the older snapshot.
  await db
    .deleteFrom('ai_traffic_insights')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where(sql<boolean>`window_end - window_start = ${w.end}::date - ${w.start}::date`)
    .where('window_end', '<', sql<Date>`${w.end}::date`)
    .execute();
}
export async function insightsRead(db: Database, scope: CrawlScope, input: CrawlReadOptions = {}) {
  const options = await withReportingTimezone(db, scope, input);
  const w = crawlWindow(options);
  const empty = (notice: string) =>
    aiTrafficInsightsSchema.parse({
      snapshot_id: null,
      window_start: w.start,
      window_end: w.end,
      formula_version: aiTraffic.formula_version,
      patterns: [],
      coverage: { crawl: 'unknown', ga4_complete: false, notice },
    });
  const [mapped, row] = await Promise.all([
    ga4Mapped(db, scope),
    insightSnapshot(db, scope, options),
  ]);
  if (!mapped)
    return empty('Connect Google Analytics to compare crawler requests with AI referrals.');
  if (!row) return empty('Insights are awaiting a persisted refresh.');
  return aiTrafficInsightsSchema.parse({
    snapshot_id: row.id,
    window_start: row.start,
    window_end: row.end,
    formula_version: row.formula_version,
    patterns: row.patterns,
    coverage: row.coverage,
  });
}
