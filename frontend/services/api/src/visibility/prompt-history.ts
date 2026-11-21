import type {
  promptHistoryImplementationSchema,
  promptHistoryPointSchema,
  promptHistorySchema,
} from '@citeladder/contracts/visibility';
import { promptCohortSchema } from '@citeladder/contracts/project';
import { sql } from 'kysely';
import type { z } from 'zod';

import { frozenComparisonKey } from '../analysis/comparison.ts';
import { statusView } from '../opportunities/action-status.ts';
import { policy } from '../config.ts';
import { notFound } from '../errors.ts';
import type { Database } from '../db/database.ts';
import { wireUtc, utcTextOf } from '../db/timestamps.ts';
import { groupBy } from '../lists.ts';
import { compareText } from '../text-order.ts';
import { scopedPrompt } from '../prompts/prompts.ts';
import { ratio } from './metrics.ts';
import { answerStates, outcomeCounts } from './prompt-outcomes.ts';
import { getPromptMetrics } from './prompts.ts';
import { marketOf, type RunScope } from './runs.ts';
import { selectedCohorts, validateEngineAndRange, validatePromptCohort } from './selection.ts';

const visibility = policy.visibility;

type PromptHistory = z.input<typeof promptHistorySchema>;
type HistoryPoint = z.input<typeof promptHistoryPointSchema>;
type Implementation = z.input<typeof promptHistoryImplementationSchema>;

export type PromptHistoryQuery = {
  promptId: string;
  logicalEngine: string | null;
  cohort: PromptHistory['cohort'] | null;
};

type ResolvedQuery = PromptHistoryQuery & { cohort: PromptHistory['cohort'] };

export async function getPromptHistory(
  db: Database,
  scope: RunScope,
  request: PromptHistoryQuery,
): Promise<PromptHistory> {
  validateEngineAndRange({ logicalEngine: request.logicalEngine, fromAt: null, toAt: null });
  const prompt = await scopedPrompt(db, scope.workspaceId, request.promptId);
  if (prompt.project_id !== scope.projectId) throw notFound('Prompt');
  const query: ResolvedQuery = {
    ...request,
    cohort: request.cohort ?? promptCohortSchema.parse(prompt.cohort),
  };
  validatePromptCohort(query.cohort);
  const [points, implementations] = await Promise.all([
    historyPoints(db, scope, query),
    implementationMarkers(db, scope, query.promptId),
  ]);
  const newest = points.at(-1);
  const latest = newest
    ? ((
        await getPromptMetrics(db, scope, {
          auditId: newest.audit_id,
          promptId: query.promptId,
          auditIds: null,
          baselineAuditIds: null,
          logicalEngine: query.logicalEngine,
          baselineId: null,
          cohort: query.cohort,
        })
      ).find((item) => item.prompt_id === query.promptId) ?? null)
    : null;
  return {
    prompt: { id: prompt.id, text: prompt.text, topic_id: prompt.topic_id, status: prompt.status },
    cohort: query.cohort,
    market_id: marketOf(scope),
    logical_engine: query.logicalEngine,
    points,
    implementations,
    latest,
  };
}

async function historyPoints(
  db: Database,
  scope: RunScope,
  query: ResolvedQuery,
): Promise<HistoryPoint[]> {
  const snapshots = (
    await db
      .selectFrom('prompt_metric_snapshots as p')
      .innerJoin('audits as a', 'a.id', 'p.audit_id')
      .select([
        'p.id',
        'p.audit_id',
        'p.prompt_index',
        'p.prompt_text',
        'p.analyzer_version',
        'p.scoring_rule_version',
        'a.configuration',
        utcTextOf(sql.ref('a.completed_at')).as('completed_at'),
      ])
      .where('p.workspace_id', '=', scope.workspaceId)
      .where('a.workspace_id', '=', scope.workspaceId)
      .where('p.project_id', '=', scope.projectId)
      .where('a.project_id', '=', scope.projectId)
      .where('p.prompt_id', '=', query.promptId)
      .where('p.cohort', 'in', [...selectedCohorts(query.cohort)])
      .where('a.market_id', 'is not distinct from', marketOf(scope))
      .where('a.audit_scope', '=', visibility.brand_audit_scope)
      .where('a.status', 'in', visibility.dashboard_audit_statuses)
      .where('a.completed_at', 'is not', null)
      .orderBy('a.completed_at', 'desc')
      .orderBy('a.id', 'desc')
      .limit(visibility.trend_max_points)
      .execute()
  ).reverse();
  if (snapshots.length === 0) return [];
  const pairs = snapshots.map((row) => ({ audit: row.audit_id, index: row.prompt_index }));
  const cohorts = [...selectedCohorts(query.cohort)];
  let answers = db
    .selectFrom('response_analyses')
    .select(['id', 'audit_id', 'prompt_index', 'brand_mentioned', 'owned_domain_cited'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('cohort', 'in', cohorts)
    .where(sql<boolean>`(audit_id, prompt_index) in (${pairList(pairs)})`);
  if (query.logicalEngine) answers = answers.where('logical_engine', '=', query.logicalEngine);
  let tasks = db
    .selectFrom('audit_tasks as task')
    .innerJoin('audit_prompt_snapshots as prompt', 'prompt.id', 'task.prompt_snapshot_id')
    .select(['task.audit_id', 'prompt.prompt_index', 'task.status'])
    .where('task.workspace_id', '=', scope.workspaceId)
    .where('prompt.cohort', 'in', cohorts)
    .where(sql<boolean>`(task.audit_id, prompt.prompt_index) in (${pairList(pairs)})`);
  if (query.logicalEngine) tasks = tasks.where('task.logical_engine', '=', query.logicalEngine);
  const [answerRows, taskRows] = await Promise.all([answers.execute(), tasks.execute()]);
  const key = (audit: string, index: number) => `${audit}:${index}`;
  const answersBy = groupBy(answerRows, (row) => key(row.audit_id, row.prompt_index));
  const tasksBy = groupBy(taskRows, (row) => key(row.audit_id, row.prompt_index));
  let previous: { key: string | null; text: string; versions: string } | null = null;
  return snapshots.map((row) => {
    const answered = answersBy.get(key(row.audit_id, row.prompt_index)) ?? [];
    const counts = outcomeCounts(answered, tasksBy.get(key(row.audit_id, row.prompt_index)) ?? []);
    const comparisonKey = frozenComparisonKey(row.configuration, query.logicalEngine, false);
    const current = {
      key: comparisonKey,
      text: row.prompt_text,
      versions: `${row.analyzer_version}\n${row.scoring_rule_version}`,
    };
    const comparable =
      previous === null
        ? null
        : current.key !== null &&
          current.key === previous.key &&
          current.text === previous.text &&
          current.versions === previous.versions;
    previous = current;
    return {
      audit_id: row.audit_id,
      completed_at: wireUtc(row.completed_at),
      prompt_text: row.prompt_text,
      counts,
      mention_rate: ratio(counts.brand_responses, counts.responses),
      owned_citation_rate: ratio(counts.owned_citation_responses, counts.responses),
      answer_states: answerStates(answered),
      source_analysis_ids: answered.map((answer) => answer.id).sort(compareText),
      comparison_key: comparisonKey,
      analyzer_version: row.analyzer_version,
      scoring_rule_version: row.scoring_rule_version,
      comparable_with_previous: comparable,
      source_snapshot_id: row.id,
    };
  });
}

const pairList = (pairs: readonly { audit: string; index: number }[]) =>
  sql.join(pairs.map(({ audit, index }) => sql`(${audit}::uuid, ${index}::int)`));

async function implementationMarkers(
  db: Database,
  scope: RunScope,
  promptId: string,
): Promise<Implementation[]> {
  const checks = JSON.stringify([{ kind: 'visibility_metric', target_prompt_id: promptId }]);
  const rows = await db
    .selectFrom('opportunity_implementation_events as ie')
    .innerJoin('actions', 'actions.id', 'ie.action_id')
    .select([
      'ie.id',
      'ie.action_id',
      'actions.target_label',
      'actions.effective_status as status',
      utcTextOf(sql.ref('ie.declared_implemented_at')).as('implemented_at'),
    ])
    .where('ie.workspace_id', '=', scope.workspaceId)
    .where('ie.project_id', '=', scope.projectId)
    .where('actions.workspace_id', '=', scope.workspaceId)
    .where('actions.project_id', '=', scope.projectId)
    .where(sql<boolean>`ie.expected_checks @> ${checks}::jsonb`)
    .orderBy('ie.declared_implemented_at', 'desc')
    .orderBy('ie.id', 'desc')
    .limit(visibility.trend_max_points)
    .execute();
  return rows.reverse().map((row) => ({
    implementation_event_id: row.id,
    action_id: row.action_id,
    title: row.target_label,
    status: statusView(row.status).status,
    implemented_at: wireUtc(row.implemented_at),
  }));
}
