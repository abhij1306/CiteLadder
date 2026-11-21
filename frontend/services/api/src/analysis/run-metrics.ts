import { randomUUID } from 'node:crypto';
import type { Selectable } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import type {
  Audits,
  AuditPromptSnapshots,
  AuditTasks,
  ResponseAnalyses,
} from '../generated/db-schema.ts';
import { round } from '../numbers.ts';
import { aggregateRun, type Aggregate, type AggregateExecution } from './aggregate.ts';
import type { scoringConfig } from './scoring.ts';

export type ScopedTask = Selectable<AuditTasks> & { cohort: string };

type Answers = {
  rows: AggregateExecution[];
  tasks: ScopedTask[];
  config: ReturnType<typeof scoringConfig>;
  engines: string[];
};

function coverage(tasks: ScopedTask[], completed: number) {
  const succeeded = tasks.filter((t) => t.status === 'succeeded').length;
  return {
    requested: tasks.length,
    completed,
    failed: tasks.filter((t) => t.status === 'failed').length,
    not_run: tasks.filter((t) => !['succeeded', 'failed'].includes(t.status)).length,
    unavailable: Math.max(0, succeeded - completed),
    rate: tasks.length ? completed / tasks.length : null,
  };
}

function cohortMetrics(
  { rows, tasks, config, engines }: Answers,
  cohorts: readonly string[],
  name: string,
) {
  const eligible = rows.filter((r) => cohorts.includes(r.cohort)),
    eligibleTasks = tasks.filter((t) => cohorts.includes(t.cohort));
  const aggregate = aggregateRun(eligible, config);
  return {
    ...aggregate,
    cohort: name,
    coverage: coverage(eligibleTasks, aggregate.total_completed),
    per_engine: Object.fromEntries(
      engines.map((engine) => {
        const value = aggregateRun(
          eligible.filter((r) => r.logical_engine === engine),
          config,
        );
        return [
          engine,
          {
            ...value,
            coverage: coverage(
              eligibleTasks.filter((t) => t.logical_engine === engine),
              value.total_completed,
            ),
          },
        ];
      }),
    ),
  };
}

export function runAggregate(answers: Answers) {
  const { rows, tasks, config } = answers;
  const organic = cohortMetrics(answers, policy.visibility.organic_cohorts, 'market_visibility');
  const comparison = cohortMetrics(answers, ['comparison'], 'comparison');
  const diagnostic: Aggregate & { cohort: string; coverage: ReturnType<typeof coverage> } = {
    ...aggregateRun(
      rows.filter((r) => r.cohort === 'brand_diagnostic'),
      config,
    ),
    cohort: 'brand_diagnostic',
    coverage: coverage(
      tasks.filter((t) => t.cohort === 'brand_diagnostic'),
      rows.filter((r) => r.cohort === 'brand_diagnostic').length,
    ),
  };
  const all = cohortMetrics(answers, policy.visibility.all_cohorts, policy.visibility.all_cohort);
  const metrics = { ...organic, comparison, brand_diagnostic: diagnostic, all };
  const visibility = organic.per_prompt.length
    ? round(
        organic.per_prompt.reduce((sum, p) => sum + p.composite_score, 0) /
          organic.per_prompt.length,
        2,
      )
    : 0;
  return { metrics, visibility, organic, comparison, diagnostic };
}

export async function persistTopicMetrics(
  db: Database,
  audit: Selectable<Audits>,
  input: Answers & {
    snapshots: Selectable<AuditPromptSnapshots>[];
    analyses: Pick<Selectable<ResponseAnalyses>, 'id' | 'prompt_index'>[];
    at: Date;
  },
): Promise<void> {
  if (audit.audit_scope !== 'brand') return;
  const names = new Map<string, string>();
  for (const snapshot of input.snapshots) {
    if (snapshot.topic_id !== null && snapshot.topic_name !== null)
      names.set(snapshot.topic_id, snapshot.topic_name);
  }
  if (names.size === 0) return;
  const topicByIndex = new Map(input.snapshots.map((s) => [s.prompt_index, s.topic_id]));
  const topicBySnapshot = new Map(input.snapshots.map((s) => [s.id, s.topic_id]));
  const values = [...names].map(([topicId, topicName]) => {
    const { metrics, visibility } = runAggregate({
      ...input,
      rows: input.rows.filter((row) => topicByIndex.get(row.prompt_index) === topicId),
      tasks: input.tasks.filter((task) => topicBySnapshot.get(task.prompt_snapshot_id) === topicId),
    });
    return {
      id: randomUUID(),
      workspace_id: audit.workspace_id,
      project_id: audit.project_id,
      audit_id: audit.id,
      topic_id: topicId,
      topic_name: topicName,
      visibility_score: visibility,
      metrics: JSON.stringify(metrics),
      source_analysis_ids: JSON.stringify(
        input.analyses
          .filter((analysis) => topicByIndex.get(analysis.prompt_index) === topicId)
          .map((analysis) => analysis.id),
      ),
      analyzer_version: policy.audits.analysis.analyzer_version,
      created_at: input.at,
    };
  });
  await db.insertInto('audit_topic_metrics').values(values).execute();
}
