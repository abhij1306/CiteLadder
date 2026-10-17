/**
 * Prompt scores for one run, or pooled over a period, with their outcomes.
 *
 * Scores are the persisted
 * `PromptMetricSnapshot` rows, strongest first; outcome counts come from the
 * persisted answers and tasks, never a rescore. A pooled period keeps counts
 * and rates and drops every single-run score.
 */
import type {
  AnswerStates,
  measurementCountsSchema,
  promptMetricItemSchema,
} from '@citeladder/contracts/visibility';
import { sql } from 'kysely';
import type { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { jsonObject, numberRecord, record, strings } from '../db/json.ts';
import { wireUtc, storedInstant, utcText, utcTextOf } from '../db/timestamps.ts';
import { compareText } from '../text-order.ts';
import { groupBy } from '../lists.ts';
import {
  cellPrompt,
  compareCells,
  loadComparisonCells,
  sharesCellContext,
  type ComparisonCell,
} from './comparison.ts';
import { ratio, round2 } from './metrics.ts';
import { runSetComparisonStatus } from './run-sets.ts';
import { marketOf, type RunScope } from './runs.ts';
import {
  AnalysisNotFoundError,
  authorizeRunSet,
  selectedCohorts,
  validateCohort,
  validateEngineAndRange,
} from './selection.ts';

const visibility = policy.visibility;
const { succeeded: SUCCEEDED, failed: FAILED } = policy.task_queue.statuses;

export type PromptMetricItem = z.input<typeof promptMetricItemSchema>;
type Counts = z.input<typeof measurementCountsSchema>;
type Outcome = NonNullable<PromptMetricItem['outcomes']>[number];
/** An item with its creation instant as sortable UTC text. */
type PromptRow = { item: PromptMetricItem; createdAt: string };

export type PromptQuery = {
  auditId: string | null;
  /** Read only this tracked prompt's row; omitted reads every prompt. */
  promptId?: string;
  auditIds: string[] | null;
  baselineAuditIds: string[] | null;
  logicalEngine: string | null;
  baselineId: string | null;
  cohort: string;
};

export async function getPromptMetrics(
  db: Database,
  scope: RunScope,
  query: PromptQuery,
): Promise<PromptMetricItem[]> {
  validateEngineAndRange({ logicalEngine: query.logicalEngine, fromAt: null, toAt: null });
  validateCohort(query.cohort);
  const rows = query.auditIds?.length
    ? await periodRows(db, scope, query, query.auditIds)
    : await runRows(db, scope, query);
  const items = rows.map((row) => row.item);
  await attachActions(db, scope, items);
  return items;
}

/** Each row's Action: the live one the refresh opened on that prompt, if any. */
async function attachActions(
  db: Database,
  scope: RunScope,
  items: readonly PromptMetricItem[],
): Promise<void> {
  const promptIds = [...new Set(items.flatMap((item) => (item.prompt_id ? [item.prompt_id] : [])))];
  const actions = promptIds.length
    ? await db
        .selectFrom('actions')
        .select(['id', 'target_prompt_id'])
        .where('workspace_id', '=', scope.workspaceId)
        .where('project_id', '=', scope.projectId)
        .where('target_prompt_id', 'in', promptIds)
        // An Action whose evidence vanished has nothing left to act on here.
        .where('evidence_cleared_at', 'is', null)
        .execute()
    : [];
  const byPrompt = new Map(actions.map((row) => [row.target_prompt_id, row.id]));
  for (const item of items)
    item.action_id = (item.prompt_id && byPrompt.get(item.prompt_id)) || null;
}

async function latestRunId(db: Database, scope: RunScope): Promise<string | null> {
  const latest = await db
    .selectFrom('audits')
    .select('id')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('market_id', 'is not distinct from', marketOf(scope))
    .where('audit_scope', '=', visibility.brand_audit_scope)
    .where('status', 'in', visibility.dashboard_audit_statuses)
    .orderBy(sql`completed_at desc nulls last`)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  return latest?.id ?? null;
}

/** One run's prompts, strongest first; no run yet is an empty list. */
async function runRows(
  db: Database,
  scope: RunScope,
  query: Omit<PromptQuery, 'auditIds' | 'baselineAuditIds'>,
): Promise<PromptRow[]> {
  let auditId = query.auditId;
  if (auditId === null) {
    auditId = await latestRunId(db, scope);
    if (auditId === null) return [];
  }
  const audit = await db
    .selectFrom('audits')
    .select(['id', 'configuration', utcText(sql.ref('completed_at')).as('completed_at')])
    .where('id', '=', auditId)
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('audit_scope', '=', visibility.brand_audit_scope)
    .executeTakeFirst();
  if (audit === undefined) throw new AnalysisNotFoundError('Audit not found');
  const rows = await scoreRows(db, scope, query, [audit.id]);
  await enrichOutcomes(db, scope, rows, { ...audit, cohort: query.cohort }, query);
  return rows;
}

async function scoreRows(
  db: Database,
  scope: RunScope,
  query: { cohort: string; promptId?: string },
  auditIds: readonly string[],
): Promise<PromptRow[]> {
  let selected = db.selectFrom('prompt_metric_snapshots');
  if (query.promptId) selected = selected.where('prompt_id', '=', query.promptId);
  const snapshots = await selected
    .selectAll()
    .select(utcTextOf(sql.ref('created_at')).as('created_at_text'))
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('audit_id', 'in', auditIds)
    .where('cohort', 'in', [...selectedCohorts(query.cohort)])
    .orderBy('composite_score', 'desc')
    .orderBy('prompt_index', 'asc')
    .execute();
  const rows: PromptRow[] = snapshots.map((row) => ({
    createdAt: row.created_at_text,
    item: {
      id: row.id,
      audit_id: row.audit_id,
      prompt_id: row.prompt_id,
      prompt_index: row.prompt_index,
      prompt_text: row.prompt_text,
      cohort: row.cohort,
      prompt_snapshot_id: null,
      composite_score: row.composite_score,
      source_audit_ids: [],
      previous_score: row.previous_score,
      immediate_delta: row.immediate_delta,
      rolling_four: numberList(row.rolling_four),
      per_engine_scores: numberRecord(jsonObject(row.per_engine_scores, 'per_engine_scores')),
      components: nullableNumbers(jsonObject(row.components, 'components')),
      engine_agreement: row.engine_agreement,
      repetition_agreement: row.repetition_agreement,
      evidence_coverage: row.evidence_coverage,
      trend_confidence: row.trend_confidence,
      decline_confirmed: row.decline_confirmed,
      analyzer_version: row.analyzer_version,
      scoring_rule_version: row.scoring_rule_version,
      created_at: wireUtc(row.created_at_text),
      theme: '',
      intent: '',
      visibility_rate: null,
      owned_citation_rate: null,
      avg_position: null,
      visibility_delta: null,
      comparison_status: 'no_baseline',
      comparison: null,
      counts: emptyCounts(),
      answer_states: null,
      action_id: null,
      outcomes: [],
    },
  }));
  return rows;
}

function numberList(value: unknown): number[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'number')) {
    throw new TypeError('rolling_four is not a list of numbers');
  }
  return value;
}

function nullableNumbers(value: Record<string, unknown>): Record<string, number | null> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (item !== null && typeof item !== 'number')
        throw new TypeError('component is not a number');
      return [key, item];
    }),
  );
}

function emptyCounts(): Counts {
  return {
    state: 'unavailable',
    responses: 0,
    brand_responses: null,
    owned_citation_responses: null,
    entity_presences: null,
    expected: null,
    failed: null,
    not_run: null,
  };
}

type Response = {
  logical_engine: string;
  transport_model: string;
  brand_mentioned: boolean;
  owned_domain_cited: boolean;
  avg_position: number | null;
  score: unknown;
};
type Task = { status: string; logical_engine: string; transport_model: string };

/** Each answer once, by whether it named the brand and cited an owned page. */
export function answerStates(
  responses: readonly Pick<Response, 'brand_mentioned' | 'owned_domain_cited'>[],
): AnswerStates | null {
  if (responses.length === 0) return null;
  const count = (mentioned: boolean, cited: boolean) =>
    responses.filter((row) => row.brand_mentioned === mentioned && row.owned_domain_cited === cited)
      .length;
  return {
    mentioned_and_cited: count(true, true),
    mentioned_only: count(true, false),
    cited_only: count(false, true),
    neither: count(false, false),
  };
}

/** Summed states; null only when no part answered. */
function poolStates(parts: readonly (AnswerStates | null | undefined)[]): AnswerStates | null {
  const present = parts.filter((part) => part != null);
  if (present.length === 0) return null;
  const total = (key: keyof AnswerStates) => present.reduce((sum, part) => sum + part[key], 0);
  return {
    mentioned_and_cited: total('mentioned_and_cited'),
    mentioned_only: total('mentioned_only'),
    cited_only: total('cited_only'),
    neither: total('neither'),
  };
}

export function outcomeCounts(
  responses: readonly Pick<Response, 'brand_mentioned' | 'owned_domain_cited'>[],
  tasks: readonly Pick<Task, 'status'>[],
): Counts {
  return {
    state: responses.length ? 'measured' : 'no_observations',
    responses: responses.length,
    expected: tasks.length,
    failed: tasks.filter((task) => task.status === FAILED).length,
    // Anything that neither succeeded nor failed has not run.
    not_run: tasks.filter((task) => task.status !== SUCCEEDED && task.status !== FAILED).length,
    brand_responses: responses.filter((row) => row.brand_mentioned).length,
    owned_citation_responses: responses.filter((row) => row.owned_domain_cited).length,
    entity_presences: null,
  };
}

function outcome(engine: string, model: string, responses: Response[], tasks: Task[]): Outcome {
  const counts = outcomeCounts(responses, tasks);
  const gaps: Record<string, number> = {};
  for (const row of responses) {
    if (row.brand_mentioned) continue;
    for (const name of strings(record(row.score).competitors_mentioned)) {
      gaps[name] = (gaps[name] ?? 0) + 1;
    }
  }
  return {
    logical_engine: engine,
    transport_model: model,
    counts,
    visibility_rate: ratio(counts.brand_responses, counts.responses),
    owned_citation_rate: ratio(counts.owned_citation_responses, counts.responses),
    answer_states: answerStates(responses),
    gap_counts: gaps,
  };
}

/** The explicitly named earlier baseline, when its frozen context matches. */
async function baselineRun(
  db: Database,
  scope: RunScope,
  audit: { configuration: unknown; completed_at: string | null },
  baselineId: string | null,
) {
  if (!baselineId || audit.completed_at === null) return null;
  const previous = await db
    .selectFrom('audits')
    .select(['id', 'configuration', utcTextOf(sql.ref('completed_at')).as('completed_at')])
    .where('id', '=', baselineId)
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    // Only a dashboard-ready brand run can be a baseline.
    .where('audit_scope', '=', visibility.brand_audit_scope)
    .where('status', 'in', visibility.dashboard_audit_statuses)
    .where('completed_at', '<', storedInstant(audit.completed_at))
    .executeTakeFirst();
  return previous && sharesCellContext(audit.configuration, previous.configuration)
    ? previous
    : null;
}

/** Frozen prompts, answers and tasks for a set of runs, loaded once. */
async function loadOutcomes(
  db: Database,
  scope: RunScope,
  auditIds: readonly string[],
  cohort: string,
  engine: string | null,
) {
  const prompts = await db
    .selectFrom('audit_prompt_snapshots')
    .select([
      'audit_id',
      'id',
      'prompt_index',
      'prompt_id',
      'text',
      'theme',
      'intent',
      'prompt_intent',
    ])
    .where('audit_id', 'in', auditIds)
    .where('cohort', 'in', [...selectedCohorts(cohort)])
    .execute();
  let answers = db
    .selectFrom('response_analyses')
    .select([
      'audit_id',
      'prompt_index',
      'logical_engine',
      'transport_model',
      'brand_mentioned',
      'owned_domain_cited',
      'avg_position',
      'score',
    ])
    .where('workspace_id', '=', scope.workspaceId)
    .where('audit_id', 'in', auditIds)
    // Scoped to the cohort these rows describe, so a comparison prompt never
    // absorbs the core answers at the same index.
    .where('cohort', 'in', [...selectedCohorts(cohort)]);
  if (engine) answers = answers.where('logical_engine', '=', engine);
  let taskQuery = db
    .selectFrom('audit_tasks as task')
    .innerJoin('audit_prompt_snapshots as prompt', 'prompt.id', 'task.prompt_snapshot_id')
    .select([
      'task.audit_id',
      'prompt.prompt_index',
      'task.status',
      'task.logical_engine',
      'task.transport_model',
    ])
    .where('task.workspace_id', '=', scope.workspaceId)
    .where('prompt.cohort', 'in', [...selectedCohorts(cohort)])
    .where('task.audit_id', 'in', auditIds);
  if (engine) taskQuery = taskQuery.where('task.logical_engine', '=', engine);
  const [answerRows, tasks] = await Promise.all([answers.execute(), taskQuery.execute()]);
  return { prompts, answers: answerRows, tasks };
}

/** Fill each row's frozen prompt facts, outcome counts and baseline change, in place. */
async function enrichOutcomes(
  db: Database,
  scope: RunScope,
  rows: readonly PromptRow[],
  audit: { id: string; configuration: unknown; completed_at: string | null; cohort: string },
  query: { logicalEngine: string | null; baselineId: string | null },
  preloaded?: Awaited<ReturnType<typeof loadOutcomes>>,
): Promise<void> {
  if (rows.length === 0) return;
  const data =
    preloaded ?? (await loadOutcomes(db, scope, [audit.id], audit.cohort, query.logicalEngine));
  const prompts = new Map(
    data.prompts.filter((row) => row.audit_id === audit.id).map((row) => [row.prompt_index, row]),
  );
  const responses = groupBy(
    data.answers.filter((row) => row.audit_id === audit.id),
    (row) => row.prompt_index,
  );
  const tasks = groupBy(
    data.tasks.filter((row) => row.audit_id === audit.id),
    (row) => row.prompt_index,
  );
  const previous = await baselineRun(db, scope, audit, query.baselineId);
  const runs = previous && {
    current: {
      auditId: audit.id,
      configuration: audit.configuration,
      workspaceId: scope.workspaceId,
    },
    previous: {
      auditId: previous.id,
      configuration: previous.configuration,
      workspaceId: scope.workspaceId,
      completedAt: previous.completed_at,
    },
  };
  const cells = runs
    ? await loadComparisonCells(db, runs, { cohort: audit.cohort, engine: query.logicalEngine })
    : null;
  for (const { item } of rows) {
    const prompt = prompts.get(item.prompt_index);
    if (prompt === undefined) throw new Error('prompt score has no frozen prompt snapshot');
    item.prompt_snapshot_id = prompt.id;
    item.theme = prompt.theme;
    item.intent = prompt.prompt_intent || prompt.intent;
    const answered = responses.get(item.prompt_index) ?? [];
    const promptTasks = tasks.get(item.prompt_index) ?? [];
    item.counts = outcomeCounts(answered, promptTasks);
    item.visibility_rate = ratio(item.counts.brand_responses, item.counts.responses);
    item.owned_citation_rate = ratio(item.counts.owned_citation_responses, item.counts.responses);
    item.answer_states = answerStates(answered);
    // Over the answers that named the brand: an unnamed answer has no rank.
    const ranked = answered.flatMap((row) => (row.avg_position === null ? [] : [row.avg_position]));
    item.avg_position = ranked.length
      ? round2(ranked.reduce((total, value) => total + value, 0) / ranked.length)
      : null;
    // A cell is one (engine, model) pair, counted against that pair's tasks.
    const cellsByRoute = groupBy(answered, (row) =>
      JSON.stringify([row.logical_engine, row.transport_model]),
    );
    item.outcomes = [...cellsByRoute.values()]
      .map((values) => ({
        engine: values[0].logical_engine,
        model: values[0].transport_model,
        values,
      }))
      .sort(
        (left, right) =>
          compareText(left.engine, right.engine) || compareText(left.model, right.model),
      )
      .map(({ engine: cellEngine, model, values }) =>
        outcome(
          cellEngine,
          model,
          values,
          promptTasks.filter(
            (task) => task.logical_engine === cellEngine && task.transport_model === model,
          ),
        ),
      );
    if (runs && cells) {
      const identity = JSON.stringify([prompt.prompt_id ?? prompt.text, prompt.text]);
      const forPrompt = (auditId: string) =>
        new Map([...cells.get(auditId)!].filter(([key]) => cellPrompt(key) === identity)) as Map<
          string,
          ComparisonCell
        >;
      item.comparison = compareCells(forPrompt(audit.id), forPrompt(previous!.id), runs);
      item.comparison_status = item.comparison?.status ?? 'no_matching_observations';
      item.visibility_delta = item.comparison?.deltas.visibility ?? null;
    }
  }
}

// --- A period: prompts pooled across a selected run set --------------------

/** A prompt is the same across runs when its identity, text, cohort, theme and intent match. */
function promptIdentity(item: PromptMetricItem): string {
  return JSON.stringify([
    item.prompt_id ?? item.prompt_text,
    item.prompt_text,
    item.cohort,
    item.theme ?? '',
    item.intent ?? '',
  ]);
}

type CountField =
  | 'brand_responses'
  | 'owned_citation_responses'
  | 'entity_presences'
  | 'expected'
  | 'failed'
  | 'not_run';
const COUNT_FIELDS: readonly CountField[] = [
  'brand_responses',
  'owned_citation_responses',
  'entity_presences',
  'expected',
  'failed',
  'not_run',
];

/** Summed counts; a field unknown in any run is unknown in the pool. */
function poolCounts(rows: readonly Counts[]): Counts {
  const responses = rows.reduce((total, row) => total + row.responses, 0);
  const pooled: Counts = {
    ...emptyCounts(),
    state: responses ? 'measured' : 'no_observations',
    responses,
  };
  for (const field of COUNT_FIELDS) {
    const values = rows.map((row) => row[field]);
    pooled[field] = values.every((value) => value !== null && value !== undefined)
      ? (values as number[]).reduce((total, value) => total + value, 0)
      : null;
  }
  return pooled;
}

function poolPrompt(rows: readonly PromptRow[]): PromptRow {
  const latest = rows.reduce((best, row) => (row.createdAt > best.createdAt ? row : best));
  const counts = poolCounts(rows.map((row) => row.item.counts ?? emptyCounts()));
  const outcomes = groupBy(
    rows.flatMap((row) => row.item.outcomes ?? []),
    (entry) => JSON.stringify([entry.logical_engine, entry.transport_model]),
  );
  return {
    createdAt: latest.createdAt,
    item: {
      ...structuredClone(latest.item),
      source_audit_ids: [...new Set(rows.map((row) => row.item.audit_id))].sort(compareText),
      counts,
      visibility_rate: ratio(counts.brand_responses, counts.responses),
      owned_citation_rate: ratio(counts.owned_citation_responses, counts.responses),
      answer_states: poolStates(rows.map((row) => row.item.answer_states)),
      // A single run's score and movement mean nothing across a pool.
      composite_score: null,
      previous_score: null,
      immediate_delta: null,
      visibility_delta: null,
      components: {},
      per_engine_scores: {},
      rolling_four: [],
      decline_confirmed: false,
      comparison: null,
      comparison_status: 'no_baseline',
      outcomes: [...outcomes.values()].map((entries) => {
        const pooled = poolCounts(entries.map((entry) => entry.counts));
        const gaps: Record<string, number> = {};
        for (const entry of entries) {
          for (const [name, count] of Object.entries(entry.gap_counts)) {
            gaps[name] = (gaps[name] ?? 0) + count;
          }
        }
        return {
          logical_engine: entries[0].logical_engine,
          transport_model: entries[0].transport_model,
          counts: pooled,
          visibility_rate: ratio(pooled.brand_responses, pooled.responses),
          owned_citation_rate: ratio(pooled.owned_citation_responses, pooled.responses),
          answer_states: poolStates(entries.map((entry) => entry.answer_states)),
          gap_counts: gaps,
        };
      }),
    },
  };
}

function poolRows(rows: readonly PromptRow[]): PromptRow[] {
  return [...groupBy(rows, (row) => promptIdentity(row.item)).values()].map(poolPrompt);
}

async function setRows(
  db: Database,
  scope: RunScope,
  query: PromptQuery,
  auditIds: readonly string[],
): Promise<PromptRow[]> {
  await authorizeRunSet(db, scope, auditIds);
  const ids = [...new Set(auditIds)];
  if (!ids.length) return [];
  const [audits, rows, data] = await Promise.all([
    db
      .selectFrom('audits')
      .select(['id', 'configuration', utcText(sql.ref('completed_at')).as('completed_at')])
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('id', 'in', ids)
      .execute(),
    scoreRows(db, scope, query, ids),
    loadOutcomes(db, scope, ids, query.cohort, query.logicalEngine),
  ]);
  const byAudit = groupBy(rows, (row) => row.item.audit_id);
  await Promise.all(
    audits.map((audit) =>
      enrichOutcomes(
        db,
        scope,
        byAudit.get(audit.id) ?? [],
        { ...audit, cohort: query.cohort },
        { logicalEngine: query.logicalEngine, baselineId: null },
        data,
      ),
    ),
  );
  return rows;
}

async function periodRows(
  db: Database,
  scope: RunScope,
  query: PromptQuery,
  auditIds: readonly string[],
): Promise<PromptRow[]> {
  const result = poolRows(await setRows(db, scope, query, auditIds));
  const baselineIds = query.baselineAuditIds ?? [];
  if (baselineIds.length === 0) return result;
  const before = new Map(
    poolRows(await setRows(db, scope, query, baselineIds)).map((row) => [
      promptIdentity(row.item),
      row.item,
    ]),
  );
  const status = await runSetComparisonStatus(db, scope, {
    currentIds: auditIds,
    baselineIds,
    responses: result.reduce((total, row) => total + (row.item.counts?.responses ?? 0), 0),
    engine: query.logicalEngine,
    cohort: query.cohort,
  });
  for (const { item } of result) {
    const previous = before.get(promptIdentity(item));
    item.comparison_status = previous === undefined ? 'no_matching_prompt' : status;
    if (previous === undefined || status !== 'comparable') continue;
    if (item.visibility_rate == null || previous.visibility_rate == null) {
      item.comparison_status = 'no_observations';
      continue;
    }
    item.visibility_delta = (item.visibility_rate - previous.visibility_rate) * 100;
  }
  return result;
}
