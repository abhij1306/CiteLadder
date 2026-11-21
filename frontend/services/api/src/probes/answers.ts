import { scoringConfig } from '../analysis/scoring.ts';
import type { Database } from '../db/database.ts';
import type { ProjectScope as Scope } from '../projects/brand-profile.ts';
import { logicalEngines, type Engine } from '../providers/config.ts';
import type { TrackedName } from './label-model.ts';
import { frozenQuestion, type ProbeQuestion } from './questions.ts';

type ProbeItem = {
  question: string;
  rank: number;
  theme_id: string | null;
  objection_group_id: string | null;
  entity_kind: string | null;
  entity_id: string | null;
};
export type ProbeAnswer = {
  taskId: string;
  engine: Engine;
  question: ProbeQuestion;
  items: ProbeItem[];
};

const engineOf = (value: string) => logicalEngines.find((engine) => engine === value);

export function answeredProbeTasks(db: Database, scope: Scope, auditIds: readonly string[]) {
  return db
    .selectFrom('audit_tasks as t')
    .innerJoin('audit_prompt_snapshots as p', (join) =>
      join.onRef('p.id', '=', 't.prompt_snapshot_id').onRef('p.audit_id', '=', 't.audit_id'),
    )
    .select(['t.id', 'p.generation_evidence'])
    .where('t.workspace_id', '=', scope.workspaceId)
    .where('t.project_id', '=', scope.projectId)
    .where('t.audit_id', 'in', auditIds)
    .where('t.status', '=', 'succeeded')
    .where('t.answer_text', '<>', '');
}

export function withQuestion<Row extends { generation_evidence: unknown }>(rows: readonly Row[]) {
  return rows.flatMap((row) => {
    const question = frozenQuestion(row.generation_evidence);
    return question ? [{ ...row, question }] : [];
  });
}

export async function probeAnswers(
  db: Database,
  scope: Scope,
  auditIds: readonly string[],
): Promise<ProbeAnswer[]> {
  if (!auditIds.length) return [];
  const [tasks, items] = await Promise.all([
    answeredProbeTasks(db, scope, auditIds).select('t.logical_engine').orderBy('t.id').execute(),
    db
      .selectFrom('probe_answer_items')
      .select([
        'task_id',
        'question',
        'rank',
        'theme_id',
        'objection_group_id',
        'entity_kind',
        'entity_id',
      ])
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('audit_id', 'in', auditIds)
      .execute(),
  ]);
  const byTask = Map.groupBy(items, (item) => item.task_id);
  return withQuestion(tasks).flatMap((task) => {
    const engine = engineOf(task.logical_engine);
    return engine
      ? [{ taskId: task.id, engine, question: task.question, items: byTask.get(task.id) ?? [] }]
      : [];
  });
}

export function probeRoster(configuration: unknown): { brand: string; tracked: TrackedName[] } {
  const config = scoringConfig(configuration);
  return {
    brand: config.brandName,
    tracked: [
      { kind: 'brand', id: null, name: config.brandName, aliases: config.brandAliases },
      ...config.competitors.flatMap(({ id, name, aliases }) =>
        id ? [{ kind: 'competitor' as const, id, name, aliases }] : [],
      ),
    ],
  };
}
