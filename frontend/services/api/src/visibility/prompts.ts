import type { promptMetricItemSchema } from '@citeladder/contracts/visibility';
import { sql } from 'kysely';
import type { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { jsonObject, numberRecord } from '../db/json.ts';
import { wireUtc, storedInstant, utcText, utcTextOf } from '../db/timestamps.ts';
import { compareText } from '../text-order.ts';
import { groupBy } from '../lists.ts';
import { cellPrompt, compareCells, loadComparisonCells, sharesCellContext } from './comparison.ts';
import { brandWinCounts } from '../analysis/win-rate.ts';
import {
  brandIdentities,
  leadingBrands,
  namedBrands,
  type BrandCount,
} from './brand-identities.ts';
import { round2 } from './metrics.ts';
import { brandMentionsByAudit } from './perception.ts';
import {
  answerStates,
  countRates,
  emptyCounts,
  outcome,
  outcomeCounts,
  poolStates,
  type Counts,
} from './prompt-outcomes.ts';
import { pooledSignals, promptSignals } from './prompt-signals.ts';
import { runSetComparisonStatus } from './run-sets.ts';
import { marketOf, type RunScope } from './runs.ts';
import {
  AnalysisNotFoundError,
  authorizeRunSet,
  latestBrandRunId,
  selectedCohorts,
  validateEngineAndRange,
  validatePromptCohort,
} from './selection.ts';

const visibility = policy.visibility;

export type PromptMetricItem = z.input<typeof promptMetricItemSchema>;
export type PromptRow = { item: PromptMetricItem; createdAt: string; named: BrandCount[] };

export type PromptQuery = {
  auditId: string | null;
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
  validatePromptCohort(query.cohort);
  const rows = query.auditIds?.length
    ? await periodRows(db, scope, query, query.auditIds)
    : await runRows(db, scope, query);
  return promptItems(db, scope, rows);
}

export async function promptItems(
  db: Database,
  scope: RunScope,
  rows: readonly PromptRow[],
): Promise<PromptMetricItem[]> {
  const items = rows.map((row) => row.item);
  await Promise.all([attachActions(db, scope, items), attachBrands(db, scope, rows)]);
  return items;
}

async function attachBrands(
  db: Database,
  scope: RunScope,
  rows: readonly PromptRow[],
): Promise<void> {
  if (!rows.some((row) => row.named.length)) return;
  const identities = await brandIdentities(db, scope);
  for (const row of rows) Object.assign(row.item, leadingBrands(row.named, identities));
}

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
        .where('evidence_cleared_at', 'is', null)
        .execute()
    : [];
  const byPrompt = new Map(actions.map((row) => [row.target_prompt_id, row.id]));
  for (const item of items)
    item.action_id = (item.prompt_id && byPrompt.get(item.prompt_id)) || null;
}

function latestRunId(db: Database, scope: RunScope): Promise<string | null> {
  return latestBrandRunId(db, { ...scope, marketId: marketOf(scope) });
}

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
    named: [],
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
      mentions: 0,
      brands: [],
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
    .where('audit_scope', '=', visibility.brand_audit_scope)
    .where('status', 'in', visibility.dashboard_audit_statuses)
    .where('completed_at', '<', storedInstant(audit.completed_at))
    .executeTakeFirst();
  return previous && sharesCellContext(audit.configuration, previous.configuration)
    ? previous
    : null;
}

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
      'id',
      'audit_id',
      'prompt_index',
      'logical_engine',
      'transport_model',
      'search_used',
      'fanout_state',
      'entity_assessments',
      'brand_mentioned',
      'owned_domain_cited',
      'avg_position',
      'score',
      'first_named_kind',
      'first_named_name',
    ])
    .where('workspace_id', '=', scope.workspaceId)
    .where('audit_id', 'in', auditIds)
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
  const [answerRows, tasks, mentions] = await Promise.all([
    answers.execute(),
    taskQuery.execute(),
    namedBrands(db, scope, { auditIds, cohort, engine }),
  ]);
  return { prompts, answers: answerRows, tasks, mentions };
}

async function withBrandMentions(
  db: Database,
  input: {
    workspaceId: string;
    audits: readonly { id: string; configuration: unknown }[];
    outcomes: Awaited<ReturnType<typeof loadOutcomes>>;
  },
) {
  const { workspaceId, audits, outcomes } = input;
  const brandMentions = await brandMentionsByAudit(db, {
    workspaceId,
    audits,
    analyses: outcomes.answers,
  });
  return { ...outcomes, brandMentions };
}

async function enrichOutcomes(
  db: Database,
  scope: RunScope,
  rows: readonly PromptRow[],
  audit: { id: string; configuration: unknown; completed_at: string | null; cohort: string },
  query: { logicalEngine: string | null; baselineId: string | null },
  preloaded?: Awaited<ReturnType<typeof withBrandMentions>>,
): Promise<void> {
  if (rows.length === 0) return;
  const data =
    preloaded ??
    (await withBrandMentions(db, {
      workspaceId: scope.workspaceId,
      audits: [audit],
      outcomes: await loadOutcomes(db, scope, [audit.id], audit.cohort, query.logicalEngine),
    }));
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
  const mentions = groupBy(
    data.mentions.filter((row) => row.audit_id === audit.id),
    (row) => row.prompt_index,
  );
  const previous = await baselineRun(db, scope, audit, query.baselineId);
  const brandMentions = data.brandMentions.get(audit.id);
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
  for (const row of rows) {
    const { item } = row;
    const prompt = prompts.get(item.prompt_index);
    if (prompt === undefined) throw new Error('prompt score has no frozen prompt snapshot');
    row.named = (mentions.get(item.prompt_index) ?? []).map(({ kind, name, responses }) => ({
      kind,
      name,
      responses,
    }));
    item.prompt_snapshot_id = prompt.id;
    item.theme = prompt.theme;
    item.intent = prompt.prompt_intent || prompt.intent;
    const answered = responses.get(item.prompt_index) ?? [];
    const promptTasks = tasks.get(item.prompt_index) ?? [];
    item.counts = outcomeCounts(answered, promptTasks);
    Object.assign(item, countRates(item.counts));
    item.answer_states = answerStates(answered);
    Object.assign(item, brandWinCounts(answered));
    Object.assign(item, promptSignals({ answered, named: row.named, brandMentions }));
    const ranked = answered.flatMap((row) => (row.avg_position === null ? [] : [row.avg_position]));
    item.avg_position = ranked.length
      ? round2(ranked.reduce((total, value) => total + value, 0) / ranked.length)
      : null;
    const routeKey = (row: { logical_engine: string; transport_model: string }) =>
      JSON.stringify([row.logical_engine, row.transport_model]);
    const cellsByRoute = groupBy(answered, routeKey);
    const tasksByRoute = groupBy(promptTasks, routeKey);
    const routes = new Map(
      [...promptTasks, ...answered].map((row) => [
        routeKey(row),
        { engine: row.logical_engine, model: row.transport_model },
      ]),
    );
    item.outcomes = [...routes]
      .sort(
        ([, left], [, right]) =>
          compareText(left.engine, right.engine) || compareText(left.model, right.model),
      )
      .map(([key, { engine: cellEngine, model }]) =>
        outcome(cellEngine, model, cellsByRoute.get(key) ?? [], tasksByRoute.get(key) ?? []),
      );
    if (runs && cells) {
      const identity = JSON.stringify([prompt.prompt_id ?? prompt.text, prompt.text]);
      const forPrompt = (auditId: string) =>
        new Map([...cells.get(auditId)!].filter(([key]) => cellPrompt(key) === identity));
      item.comparison = compareCells(forPrompt(audit.id), forPrompt(previous!.id), runs);
      item.comparison_status = item.comparison?.status ?? 'no_matching_observations';
      item.visibility_delta = item.comparison?.deltas.visibility ?? null;
    }
  }
}

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
      ? values.reduce((total, value) => total + value, 0)
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
  const named = new Map<string, BrandCount>();
  for (const entry of rows.flatMap((row) => row.named)) {
    const key = JSON.stringify([entry.kind, entry.name]);
    const pooled = named.get(key);
    named.set(key, { ...entry, responses: (pooled?.responses ?? 0) + entry.responses });
  }
  return {
    createdAt: latest.createdAt,
    named: [...named.values()],
    item: {
      ...structuredClone(latest.item),
      source_audit_ids: [...new Set(rows.map((row) => row.item.audit_id))].sort(compareText),
      counts,
      ...countRates(counts),
      answer_states: poolStates(rows.map((row) => row.item.answer_states)),
      ...pooledSignals(
        rows.map((row) => row.item),
        [...named.values()],
      ),
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
          ...countRates(pooled),
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
  return enrichedRows(db, scope, query, [...new Set(auditIds)]);
}

export async function enrichedRows(
  db: Database,
  scope: RunScope,
  query: Pick<PromptQuery, 'cohort' | 'logicalEngine' | 'promptId'>,
  ids: readonly string[],
): Promise<PromptRow[]> {
  if (!ids.length) return [];
  const [audits, rows, outcomes] = await Promise.all([
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
  const data = await withBrandMentions(db, {
    workspaceId: scope.workspaceId,
    audits,
    outcomes,
  });
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
