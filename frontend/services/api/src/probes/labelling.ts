import { randomUUID } from 'node:crypto';

import type { Insertable } from 'kysely';
import type { z } from 'zod';

import { meterFor } from '../billing/metering.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import type { ProbeAnswerItems } from '../generated/db-schema.ts';
import { parseUuid } from '../http/uuid.ts';
import type { ModelGateway } from '../models/gateway.ts';
import { callStructured, configuredGateway, type ModelCall } from '../perception/model-call.ts';
import type { ProjectScope as Scope } from '../projects/brand-profile.ts';
import { listThemes, nameKey } from '../projects/themes.ts';
import { payloadString, taskProject, type Executor } from '../queue/executor.ts';
import type { QueueTask } from '../queue/task-queue.ts';
import { answeredProbeTasks, probeRoster, withQuestion } from './answers.ts';
import {
  covering,
  knownForOutput,
  knownForRequest,
  mapKnownFor,
  mapObjections,
  mapThemeBrands,
  objectionOutput,
  objectionRequest,
  themeOutput,
  themeRequest,
  type LabelAnswer,
} from './label-model.ts';
import { ANSWERED_STATUSES } from './launch-end.ts';
import { probeAudits } from './launches.ts';
import { listGroups, saveAnswerItems, saveGroups } from './objection-groups.ts';

const probes = policy.probes;

async function loadLaunch(db: Database, task: QueueTask, scope: Scope) {
  const launchId = parseUuid(payloadString(task, 'launch_id'));
  if (launchId === null) throw new Error('probe_labelling payload missing launch_id');
  const audits = await probeAudits(db, scope)
    .select(['a.id', 'a.configuration'])
    .where('a.launch_id', '=', launchId)
    .where('a.status', 'in', ANSWERED_STATUSES)
    .orderBy('a.created_at')
    .orderBy('a.id')
    .execute();
  const rows = audits.length
    ? await answeredProbeTasks(
        db,
        scope,
        audits.map((audit) => audit.id),
      )
        .select(['t.audit_id', 't.answer_text', 'p.text as question_text'])
        .orderBy('t.prompt_index')
        .orderBy('t.logical_engine')
        .orderBy('t.audit_id')
        .orderBy('t.repetition')
        .execute()
    : [];
  const answers = withQuestion(rows).map((row) => ({
    taskId: row.id,
    auditId: row.audit_id,
    text: row.answer_text,
    questionText: row.question_text,
    question: row.question,
  }));
  return { launchId, configuration: audits[0]?.configuration, answers };
}

async function labelled(db: Database, scope: Scope, launchId: string) {
  const row = await db
    .selectFrom('probe_labellings')
    .select('id')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('launch_id', '=', launchId)
    .executeTakeFirst();
  return row !== undefined;
}

class LabellingFailed extends Error {}

async function ask<Value, Result>(
  gateway: ModelGateway,
  calls: ModelCall[],
  request: { user: string; schema: z.ZodType<Value> },
  accept: (value: Value) => Result,
): Promise<Result> {
  const { call, outcome } = await callStructured(
    gateway,
    {
      system: probes.system_template,
      user: request.user,
      schema: request.schema,
      inputHash: '',
      maxAttempts: probes.max_attempts,
    },
    (value) => ({ outcome: 'ok' as const, value: accept(value) }),
  );
  calls.push(call);
  if (outcome.outcome !== 'ok') throw new LabellingFailed(`probe labelling ${outcome.outcome}`);
  return outcome.value;
}

type Launch = Awaited<ReturnType<typeof loadLaunch>>;
type Labels = {
  known: ReturnType<typeof mapKnownFor>;
  objections: ReturnType<typeof mapObjections>;
  themes: (ReturnType<typeof mapThemeBrands>[number] & { themeId: string })[];
};

async function label(db: Database, gateway: ModelGateway, scope: Scope, launch: Launch) {
  const { brand, tracked: roster } = probeRoster(launch.configuration);
  const [themes, groups] = await Promise.all([listThemes(db, scope), listGroups(db, scope)]);
  const calls: ModelCall[] = [];
  const max = probes.max_items_per_answer;
  const labels: Labels = { known: [], objections: { items: [], newGroups: [] }, themes: [] };
  for (const run of Map.groupBy(launch.answers, (answer) => answer.auditId).values()) {
    const of = (question: string): LabelAnswer[] =>
      run.filter((answer) => answer.question.question === question);
    const known = of('known_for');
    const objections = of('objection');
    if (known.length) {
      const request = {
        user: knownForRequest(probes, {
          brand,
          fallback: policy.perception.project_themes.fallback,
          themes,
          answers: known,
        }),
        schema: covering(knownForOutput, known.length),
      };
      const accept = (value: z.infer<typeof knownForOutput>) =>
        mapKnownFor(value, known, { themes, maxItems: max });
      labels.known.push(...(await ask(gateway, calls, request, accept))); // NOSONAR -- One call per market, in order.
    }
    if (objections.length) {
      const named = labels.objections.newGroups;
      const request = {
        user: objectionRequest(probes, {
          brand,
          groups: [...groups, ...named.map((name) => ({ name }))],
          answers: objections,
        }),
        schema: covering(objectionOutput, objections.length),
      };
      const accept = (value: z.infer<typeof objectionOutput>) =>
        mapObjections(value, objections, {
          groups,
          named,
          maxItems: max,
          maxNewGroups: probes.max_new_groups_per_probe,
          nameMaxChars: probes.group_name_max_chars,
        });
      const mapped = await ask(gateway, calls, request, accept); // NOSONAR -- Each market sees the groups the earlier ones named.
      labels.objections = {
        items: [...labels.objections.items, ...mapped.items],
        newGroups: mapped.newGroups,
      };
    }
  }
  const byQuestion = Map.groupBy(
    launch.answers.filter((answer) => answer.question.question === 'theme'),
    (answer) => answer.questionText,
  );
  for (const [question, answers] of byQuestion) {
    const [sample] = answers;
    const asked = sample?.question;
    if (asked?.question !== 'theme' || !themes.some((theme) => theme.id === asked.theme_id))
      continue;
    const request = {
      user: themeRequest(probes, { question, answers }),
      schema: covering(themeOutput, answers.length),
    };
    const accept = (value: z.infer<typeof themeOutput>) =>
      mapThemeBrands(value, answers, { tracked: roster, maxItems: max });
    const mapped = await ask(gateway, calls, request, accept); // NOSONAR -- One call per theme question, in order.
    labels.themes.push(...mapped.map((item) => ({ ...item, themeId: asked.theme_id })));
  }
  return { labels, calls };
}

type Outcome =
  | { outcome: 'labelled'; labels: Labels }
  | { outcome: 'unavailable'; reason: 'model_not_configured' | 'task_failed' };

async function answerRows(
  db: Database,
  scope: Scope,
  input: { launch: Launch; labellingId: string; labels: Labels; at: Date },
) {
  const { known, objections, themes } = input.labels;
  const [current, groupIds] = await Promise.all([
    listThemes(db, scope),
    saveGroups(db, scope, objections.newGroups, input.at),
  ]);
  const liveThemes = new Set(current.map((theme) => theme.id));
  const liveGroups = new Set(groupIds.values());
  const auditOf = new Map(input.launch.answers.map((answer) => [answer.taskId, answer.auditId]));
  const row = (
    item: { taskId: string; rank: number },
    question: string,
    fields: Partial<Insertable<ProbeAnswerItems>>,
  ): Insertable<ProbeAnswerItems> => ({
    id: randomUUID(),
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    audit_id: auditOf.get(item.taskId)!,
    labelling_id: input.labellingId,
    task_id: item.taskId,
    question,
    rank: item.rank,
    theme_id: null,
    objection_group_id: null,
    entity_kind: null,
    entity_id: null,
    entity_name: null,
    quote: '',
    created_at: input.at,
    ...fields,
  });
  return [
    ...known.map((item) =>
      row(item, 'known_for', {
        theme_id: item.themeId && liveThemes.has(item.themeId) ? item.themeId : null,
        quote: item.quote,
      }),
    ),
    ...objections.items.flatMap((item) => {
      const group =
        item.group.kind === 'existing' ? item.group.id : groupIds.get(nameKey(item.group.name));
      return group && liveGroups.has(group)
        ? [row(item, 'objection', { objection_group_id: group, quote: item.quote })]
        : [];
    }),
    ...themes.flatMap((item) =>
      liveThemes.has(item.themeId)
        ? [
            row(item, 'theme', {
              theme_id: item.themeId,
              entity_kind: item.entity.kind,
              entity_id: item.entity.id,
              entity_name: item.entity.name,
            }),
          ]
        : [],
    ),
  ];
}

function persist(scope: Scope, launch: Launch, outcome: Outcome, calls: ModelCall[]) {
  return async (db: Database) => {
    const id = randomUUID();
    const at = new Date();
    const inserted = await db
      .insertInto('probe_labellings')
      .values({
        id,
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        launch_id: launch.launchId,
        labelling_version: probes.labelling_version,
        outcome: outcome.outcome,
        outcome_reason: outcome.outcome === 'unavailable' ? outcome.reason : null,
        model_provider: calls[0]?.provider ?? null,
        model: calls[0]?.model ?? null,
        usage: calls.length ? JSON.stringify({ calls: calls.map((call) => call.usage) }) : null,
        created_at: at,
      })
      .onConflict((conflict) => conflict.column('launch_id').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!inserted || outcome.outcome !== 'labelled') return;
    await saveAnswerItems(
      db,
      await answerRows(db, scope, { launch, labellingId: id, labels: outcome.labels, at }),
    );
  };
}

export function probeLabelling(
  gatewayFactory: () => ModelGateway | null = configuredGateway,
): Executor {
  return async (task, { db, checkCancelled }) => {
    const scope = { workspaceId: task.workspace_id, projectId: await taskProject(db, task) };
    const launch = await loadLaunch(db, task, scope);
    if (await labelled(db, scope, launch.launchId)) return;
    const settle = (outcome: Outcome, calls: ModelCall[] = []) => ({
      error: null,
      persist: persist(scope, launch, outcome, calls),
    });
    const raw = gatewayFactory();
    if (!raw) return settle({ outcome: 'unavailable', reason: 'model_not_configured' });
    const gateway = meterFor(db, task.workspace_id).gateway(raw, 'probe_labelling');
    await checkCancelled('probe_labelling_model_call');
    const { labels, calls } = await label(db, gateway, scope, launch);
    return settle({ outcome: 'labelled', labels }, calls);
  };
}

export async function compensateProbeLabelling(db: Database, task: QueueTask) {
  const scope = { workspaceId: task.workspace_id, projectId: await taskProject(db, task) };
  const launch = await loadLaunch(db, task, scope);
  await persist(scope, launch, { outcome: 'unavailable', reason: 'task_failed' }, [])(db);
}
