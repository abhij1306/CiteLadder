import { z } from 'zod';
import { auditRuntime } from '../audits/config.ts';
import { estimateAudit } from '../audits/estimate.ts';
import { auditLaunchDraft, auditLaunchInput } from '../audits/inputs.ts';
import { createRepairAudit, repairInput } from '../audits/repair.ts';
import { scheduleCreate, scheduleUpdate } from '../audits/schedule-inputs.ts';
import { readSchedule } from '../audits/schedules.ts';
import { AUDITS_CANCEL, AUDITS_RUN, cancelAudit, launchAudit } from '../commands/audits.ts';
import {
  createSchedule,
  deleteSchedule,
  SCHEDULES_WRITE,
  updateSchedule,
} from '../commands/schedules.ts';
import { notFound } from '../errors.ts';
import {
  changeKind,
  countOf,
  heldUnits,
  MEMBER_RUN,
  PERMANENT,
  plural,
  ROW_COUNT,
  type PreviewContext,
} from './kind.ts';
import { promptSetName } from './prompt-kinds.ts';

type LaunchRequest = z.output<typeof auditLaunchDraft>;
const RUNS = { label: 'Open Runs', path: '/runs' };

async function projectAudit(
  db: PreviewContext['db'],
  scope: Omit<PreviewContext, 'db' | 'config'>,
  auditId: string,
) {
  const audit = await db
    .selectFrom('audits')
    .select(['id', 'created_at', 'status'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', auditId)
    .executeTakeFirst();
  if (!audit) throw notFound('Audit');
  return audit;
}

const scheduleOf = (context: PreviewContext, id: string) =>
  readSchedule(context.db, { workspaceId: context.workspaceId, projectId: context.projectId }, id);

function estimate(context: PreviewContext, request: LaunchRequest) {
  return estimateAudit(
    context.db,
    context.workspaceId,
    {
      prompt_set_id: request.prompt_set_id ?? null,
      prompt_ids: request.prompt_ids,
      engines: request.engines,
      repetitions: request.repetitions ?? null,
      market_ids: request.market_ids,
      project_id: context.projectId,
    },
    auditRuntime(context.config.settings),
  );
}

async function repairSpend(
  context: PreviewContext,
  rehearsed: { audit: { id: string; created: boolean } },
) {
  if (!rehearsed.audit.created) return 'Nothing new: these answers are already queued';
  const tasks = await context.db
    .selectFrom('audit_tasks')
    .select('id')
    .where('workspace_id', '=', context.workspaceId)
    .where('audit_id', '=', rehearsed.audit.id)
    .execute();
  const runs = await heldUnits(context.db, {
    workspaceId: context.workspaceId,
    kind: 'audit',
    ids: tasks.map((task) => task.id),
  });
  return `${plural(runs, 'prompt run')} for ${plural(tasks.length, 'answer')}, with your own provider keys`;
}

export const auditKinds = {
  launch_audit: changeKind({
    permission: AUDITS_RUN,
    purpose:
      'launch an audit of a prompt set or chosen prompts on given engines; spends prompt runs when confirmed',
    payload: z.strictObject({ request: auditLaunchInput }),
    draft: {
      schema: z.strictObject({ request: auditLaunchDraft }),
      async complete(context, draft) {
        const estimated = await estimate(context, draft.request);
        return { request: { ...draft.request, max_attempts: estimated.maximum_attempt_count } };
      },
    },
    async execute(trx, config, actor, change, payload) {
      const audits = await launchAudit(trx, config, actor, change.projectId, payload.request);
      const launched =
        audits.length === 1 ? 'the audit' : `${audits.length} audits, one per market`;
      return {
        summary: `Launched ${launched}. Queued; runs start shortly.`,
        audits: audits.map((audit) => ({
          id: audit.id,
          status: audit.status,
          market: audit.market,
        })),
      };
    },
    async preview(context, payload) {
      const estimated = await estimate(context, payload.request);
      return {
        title:
          estimated.market_count === 1
            ? 'Launch an audit'
            : `Launch ${estimated.market_count} audits, one per market`,
        rows: [
          { label: 'Prompts', value: String(estimated.prompt_count) },
          { label: 'Engines', value: payload.request.engines.join(', ') },
          { label: 'Repetitions', value: String(estimated.repetition_count) },
          { label: 'Answers', value: String(estimated.execution_count) },
        ],
        spend: `Up to ${plural(estimated.execution_count, 'prompt run')}, in at most ${plural(payload.request.max_attempts, 'provider attempt')}`,
        opens: RUNS,
      };
    },
  }),
  cancel_audit: changeKind({
    permission: AUDITS_CANCEL,
    purpose:
      'stop a queued or running audit; answers so far are kept (read_visibility_overview view runs)',
    payload: z.strictObject({ audit_id: z.uuid() }),
    async execute(trx, _config, actor, change, payload) {
      await cancelAudit(trx, actor, change.projectId, payload.audit_id);
      return { summary: 'The audit was cancelled.' };
    },
    async preview(context, payload) {
      const audit = await context.db
        .selectFrom('audits')
        .select(['status', 'created_at'])
        .where('workspace_id', '=', context.workspaceId)
        .where('project_id', '=', context.projectId)
        .where('id', '=', payload.audit_id)
        .executeTakeFirst();
      return {
        title: 'Cancel an audit',
        rows: audit
          ? [
              { label: 'Started', value: audit.created_at.toISOString().slice(0, 16) },
              { label: 'Status', value: audit.status },
            ]
          : [],
        spend: null,
        opens: RUNS,
      };
    },
  }),
  schedule: changeKind({
    permission: SCHEDULES_WRITE,
    purpose: 'create a recurring audit schedule for a prompt set',
    payload: z.strictObject({ schedule: scheduleCreate }),
    async execute(trx, _config, actor, change, payload) {
      const schedule = await createSchedule(trx, actor, change.projectId, payload.schedule);
      return {
        summary: `Created a ${schedule.cadence} audit schedule.`,
        schedule: { id: schedule.id, next_run_at: schedule.next_run_at },
      };
    },
    async preview(context, payload) {
      const { schedule } = payload;
      return {
        title: `Create a ${schedule.cadence.replaceAll('_', ' ')} audit schedule`,
        rows: [
          { label: 'Prompt set', value: await promptSetName(context, schedule.prompt_set_id) },
          { label: 'Engines', value: schedule.engines.join(', ') },
          { label: 'Markets', value: String(schedule.market_ids.length) },
          { label: 'Timezone', value: schedule.timezone },
          { label: 'First run', value: schedule.next_run_at ?? 'Right away' },
        ],
        spend: 'Each scheduled run spends one prompt run per recorded answer',
        opens: null,
      };
    },
  }),
  rerun_audit_failures: changeKind({
    permission: MEMBER_RUN,
    purpose:
      'run the failed answers of a finished audit again with the provider keys they used, as a new repair audit (read_visibility_overview view runs)',
    payload: z.strictObject({ audit_id: z.uuid(), filter: repairInput.default({}) }),
    async execute(trx, config, actor, change, payload) {
      const scope = { workspaceId: actor.workspaceId, projectId: change.projectId };
      await projectAudit(trx, scope, payload.audit_id);
      const repair = await createRepairAudit(
        trx,
        actor.workspaceId,
        payload.audit_id,
        payload.filter,
        auditRuntime(config.settings),
      );
      return {
        summary: repair.created
          ? 'Queued the failed answers to run again.'
          : 'These failed answers are already queued to run again.',
        audit: { id: repair.auditId, created: repair.created },
      };
    },
    async preview(context, payload, rehearse) {
      const audit = await projectAudit(context.db, context, payload.audit_id);
      return {
        title: 'Run failed answers again',
        rows: [
          { label: 'Audit started', value: audit.created_at.toISOString().slice(0, 16) },
          { label: 'Status', value: audit.status },
        ],
        spend: await repairSpend(context, await rehearse()),
        opens: RUNS,
      };
    },
  }),
  update_audit_schedule: changeKind({
    permission: SCHEDULES_WRITE,
    purpose:
      'change an audit schedule (cadence, engines, markets, timing) or pause it (enabled) (read_visibility_overview view schedules)',
    payload: z.strictObject({ schedule_id: z.uuid(), changes: scheduleUpdate }),
    async execute(trx, _config, actor, change, payload) {
      const schedule = await updateSchedule(
        trx,
        actor,
        change.projectId,
        payload.schedule_id,
        payload.changes,
      );
      return { summary: `The ${schedule.cadence} audit schedule is updated.` };
    },
    async preview(context, payload) {
      const schedule = await scheduleOf(context, payload.schedule_id);
      return {
        title: 'Change an audit schedule',
        rows: [
          { label: 'Prompt set', value: await promptSetName(context, schedule.prompt_set_id) },
          { label: 'Now', value: schedule.cadence.replaceAll('_', ' ') },
          ...Object.entries(payload.changes).map(([field, value]) => ({
            label: field.replaceAll('_', ' '),
            value: JSON.stringify(value),
          })),
        ],
        spend: null,
        opens: null,
      };
    },
  }),
  delete_audit_schedule: changeKind({
    permission: SCHEDULES_WRITE,
    purpose:
      'delete an audit schedule; audits it already ran stay (read_visibility_overview view schedules)',
    payload: z.strictObject({ schedule_id: z.uuid() }),
    async execute(trx, _config, actor, change, payload) {
      await deleteSchedule(trx, actor, change.projectId, payload.schedule_id);
      return { summary: 'Deleted the audit schedule.' };
    },
    async preview(context, payload) {
      const schedule = await scheduleOf(context, payload.schedule_id);
      const ran = await countOf(
        context.db
          .selectFrom('audits')
          .select(ROW_COUNT)
          .where('workspace_id', '=', context.workspaceId)
          .where('schedule_id', '=', schedule.id)
          .executeTakeFirst(),
      );
      return {
        title: 'Delete an audit schedule',
        rows: [
          { label: 'Prompt set', value: await promptSetName(context, schedule.prompt_set_id) },
          { label: 'Cadence', value: schedule.cadence.replaceAll('_', ' ') },
          { label: 'Audits it ran', value: `${ran}, kept` },
          PERMANENT,
        ],
        spend: null,
        opens: null,
      };
    },
  }),
};
