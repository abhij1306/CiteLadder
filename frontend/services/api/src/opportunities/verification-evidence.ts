/**
 * One source's reading of a declaration's expected checks. Each source reads
 * only the check kinds it can measure and leaves the others untouched, so
 * their earlier states carry forward in the merged observation.
 */
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { parseUuid } from '../http/uuid.ts';
import { record } from '../db/json.ts';
import {
  keywordPresenceExpectedCheckSchema,
  type ExpectedCheck,
} from '@citeladder/contracts/opportunities';
import { keywordDatasetOutcome, keywordTrafficOutcome } from './keyword-verification.ts';
import {
  checkWindowDays,
  compareMetric,
  expectedRuleOutcome,
  evaluation,
  outcome,
  promptScore,
  type CheckOutcome,
  type Evaluation,
  type Reading,
} from './verification-decisions.ts';
import { scopedDailyRate, windowDays } from './traffic-scope.ts';
import type { Declaration } from './verification-result.ts';
import { scalarText } from '../text-order.ts';
import { contextualLinkObserved } from './internal-link-verification.ts';

export type Source = { kind: string; id: string; observed_at: string };
type Context = {
  db: Database;
  scope: WorkspaceScope;
  declaration: Declaration;
  result: Evaluation;
  reading: Reading;
  /** One read per page, snapshot or row a declaration's checks share. */
  reads: Map<string, Promise<unknown>>;
};
type Check = Record<string, unknown>;

/** The check kinds each source kind can read. */
export const SOURCE_CHECK_KINDS: Record<string, readonly ExpectedCheck['kind'][]> = {
  site_crawl: ['site_rule', 'contextual_link'],
  audit: ['visibility_metric'],
  traffic_snapshot: ['traffic_metric', 'keyword_presence'],
  search_intelligence_dataset: ['keyword_presence'],
};

const checksOf = (d: Declaration) =>
  Array.isArray(d.expected_checks) ? d.expected_checks.map(record) : [];
const dayOf = (iso: string) => iso.slice(0, 10);
function once<T>(ctx: Context, key: string, read: () => Promise<T>): Promise<T> {
  if (!ctx.reads.has(key)) ctx.reads.set(key, read());
  return ctx.reads.get(key) as Promise<T>;
}
const set = (ctx: Context, index: number, item: CheckOutcome | null) => {
  if (item) ctx.result.outcomes.set(index, item);
};

type SiteAnalysis = { id: string; normalized_facts: unknown; source_evaluation_ids: unknown };

async function siteRuleOutcome(ctx: Context, analysis: SiteAnalysis, check: Check) {
  const ids = Array.isArray(analysis.source_evaluation_ids)
    ? analysis.source_evaluation_ids.map(String)
    : [];
  const rule = ids.length
    ? await ctx.scope
        .selectFrom(ctx.db, 'site_rule_evaluations')
        .select(['id', 'outcome'])
        .where('id', 'in', ids)
        .where('rule_id', '=', scalarText(check.rule_id ?? ''))
        .executeTakeFirst()
    : undefined;
  if (!rule || !['satisfied', 'missing', 'partial'].includes(rule.outcome))
    return outcome(ctx.reading, 'unavailable', 'rule_not_evaluated');
  ctx.result.rule_evaluation_ids.add(rule.id);
  ctx.result.analysis_ids.add(analysis.id);
  return outcome(
    ctx.reading,
    rule.outcome === expectedRuleOutcome(check.expected_outcome) ? 'met' : 'unmet',
  );
}

function contextualLinkOutcome(ctx: Context, analysis: SiteAnalysis, check: Check) {
  const observed = contextualLinkObserved(analysis.normalized_facts, check);
  if (observed === null) return outcome(ctx.reading, 'unavailable', 'link_capture_incomplete');
  ctx.result.analysis_ids.add(analysis.id);
  return outcome(ctx.reading, observed ? 'met' : 'unmet');
}

async function siteCheck(ctx: Context, crawlId: string, check: Check) {
  const d = ctx.declaration;
  const targets = Array.isArray(d.target_site_url_ids) ? d.target_site_url_ids : [];
  const target = parseUuid(check.target_site_url_id ?? (targets.length === 1 ? targets[0] : null));
  if (!target) return outcome(ctx.reading, 'unavailable', 'no_resolved_target');
  const analysis = await once(ctx, `analysis:${target}`, () =>
    ctx.scope
      .selectFrom(ctx.db, 'site_page_analyses')
      .innerJoin(
        'site_fetch_artifacts',
        'site_fetch_artifacts.id',
        'site_page_analyses.artifact_id',
      )
      .select([
        'site_page_analyses.id',
        'site_page_analyses.source_evaluation_ids',
        'site_fetch_artifacts.normalized_facts',
      ])
      .where('site_fetch_artifacts.workspace_id', '=', d.workspace_id)
      .where('site_page_analyses.project_id', '=', d.project_id)
      .where('site_page_analyses.crawl_id', '=', crawlId)
      .where('site_page_analyses.site_url_id', '=', target)
      .where('site_page_analyses.is_current', '=', true)
      .where('site_page_analyses.finalized_at', 'is not', null)
      .where(
        'site_fetch_artifacts.fetched_at',
        '>',
        sql<Date>`${d.declared_implemented_at}::timestamptz`,
      )
      .orderBy('site_page_analyses.created_at', 'desc')
      .orderBy('site_page_analyses.id', 'desc')
      .limit(1)
      .executeTakeFirst(),
  );
  if (!analysis) return outcome(ctx.reading, 'unavailable', 'page_not_analyzed');
  return check.kind === 'site_rule'
    ? siteRuleOutcome(ctx, analysis, check)
    : contextualLinkOutcome(ctx, analysis, check);
}

/** A prompt's score in this audit against the score frozen at declaration. */
async function visibilityCheck(ctx: Context, auditId: string, check: Check) {
  const d = ctx.declaration;
  const prompt = parseUuid(check.target_prompt_id);
  // Checks declared against the project-wide score measured nothing the
  // Action changed; they stay unmeasurable rather than verify by drift.
  if (!prompt) return outcome(ctx.reading, 'unavailable', 'not_prompt_scoped');
  const snapshot = await once(ctx, 'metric_snapshot', () =>
    ctx.scope
      .selectFrom(ctx.db, 'metric_snapshots')
      .select(['id', 'metrics'])
      .where('project_id', '=', d.project_id)
      .where('audit_id', '=', auditId)
      .where('created_at', '>', sql<Date>`${d.declared_implemented_at}::timestamptz`)
      .executeTakeFirst(),
  );
  if (!snapshot) return outcome(ctx.reading, 'unavailable', 'no_metric_snapshot');
  const row = await ctx.scope
    .selectFrom(ctx.db, 'audits')
    .innerJoin('audit_prompt_snapshots', 'audit_prompt_snapshots.audit_id', 'audits.id')
    .select('prompt_index')
    .where('audits.id', '=', auditId)
    .where('prompt_id', '=', prompt)
    .executeTakeFirst();
  if (!row) return outcome(ctx.reading, 'unavailable', 'prompt_not_in_run');
  ctx.result.metric_ids.add(snapshot.id);
  return compareMetric(
    check,
    check.baseline_value,
    promptScore(snapshot.metrics, row.prompt_index),
    ctx.reading,
    'prompt_score_unavailable',
  );
}

/**
 * Clicks per day on the declared page or query, in a window that starts
 * after the go-live day (that day is partly before the change, and its UTC
 * date can differ from the user's), against the frozen pre-declaration rate.
 * Sync windows differ in length, so windows compare as daily rates.
 */
async function trafficCheck(ctx: Context, snapshotId: string, check: Check) {
  const d = ctx.declaration;
  const scope = check.scope;
  const key = scalarText(check.scope_key);
  if ((scope !== 'page' && scope !== 'query') || !key)
    return outcome(ctx.reading, 'unavailable', 'not_page_scoped');
  const snapshot = await once(ctx, 'traffic_snapshot', () =>
    ctx.scope
      .selectFrom(ctx.db, 'traffic_snapshots')
      .select(['id', sql<string>`window_start::date::text`.as('start'), windowDays.as('days')])
      .where('project_id', '=', d.project_id)
      .where('id', '=', snapshotId)
      .executeTakeFirst(),
  );
  if (!snapshot) return outcome(ctx.reading, 'unavailable', 'no_traffic_snapshot');
  if (snapshot.start <= dayOf(d.declared_implemented_at))
    return outcome(ctx.reading, 'unavailable', 'window_overlaps_declaration');
  const { rowId, rate } = await scopedDailyRate(
    ctx.db,
    { workspaceId: d.workspace_id, projectId: d.project_id },
    snapshot,
    { scope, key, metric: scalarText(check.metric) },
  );
  if (rowId) ctx.result.metric_ids.add(rowId);
  return compareMetric(check, check.baseline_value, rate, ctx.reading, 'no_search_console_row');
}

/** This source's outcomes for the declaration's checks it can read. */
export async function evidenceFor(
  db: Database,
  declaration: Declaration,
  source: Source,
): Promise<Evaluation> {
  const ctx: Context = {
    db,
    declaration,
    scope: new WorkspaceScope(declaration.workspace_id),
    result: evaluation(),
    reads: new Map(),
    reading: { observed_at: source.observed_at, source_kind: source.kind, source_id: source.id },
  };
  const readable = SOURCE_CHECK_KINDS[source.kind] ?? [];
  const age = Date.parse(source.observed_at) - Date.parse(declaration.declared_implemented_at);
  for (const [index, check] of checksOf(declaration).entries()) {
    const kind = readable.find((item) => item === check.kind);
    if (!kind) continue;
    // Past its own window a check keeps its last reading.
    if (age > checkWindowDays(kind) * DAY_MS) continue;
    // One source reads its checks in order on the caller's connection.
    set(ctx, index, await readCheck(ctx, source, check)); // NOSONAR
  }
  return ctx.result;
}

const DAY_MS = 86_400_000;

function readCheck(ctx: Context, source: Source, check: Check) {
  if (check.kind === 'keyword_presence') {
    // A frozen check that no longer parses cannot be read; say so rather than wait.
    const parsed = keywordPresenceExpectedCheckSchema.safeParse(check);
    if (!parsed.success) return outcome(ctx.reading, 'unavailable', 'malformed_check');
    return source.kind === 'traffic_snapshot'
      ? keywordTrafficOutcome(ctx, source.id, parsed.data)
      : keywordDatasetOutcome(ctx, source.id, parsed.data);
  }
  if (source.kind === 'site_crawl') return siteCheck(ctx, source.id, check);
  if (source.kind === 'audit') return visibilityCheck(ctx, source.id, check);
  return trafficCheck(ctx, source.id, check);
}
