import { z } from 'zod';
import {
  actionAnalyzeRequestSchema,
  actionBulkStatusRequestSchema,
  actionDeclarationRequestSchema,
  actionUserStatusSchema,
} from '@citeladder/contracts/actions';
import { opportunityOrderUpdateRequestSchema } from '@citeladder/contracts/opportunities';
import {
  ACTIONS_WRITE,
  declareAction,
  setActionStatus,
  setActionStatuses,
} from '../commands/actions.ts';
import { notFound } from '../errors.ts';
import { updateOrder } from '../opportunities/order.ts';
import { analyzePage } from '../page-documents/analyze.ts';
import { changeKind, MEMBER_RUN, MEMBER_WRITE, plural, type PreviewContext } from './kind.ts';

const ACTIONS = { label: 'Open Actions', path: '/actions' };

async function projectActionLabels(context: PreviewContext, ids: readonly string[]) {
  const rows = await context.db
    .selectFrom('actions')
    .select('target_label')
    .where('workspace_id', '=', context.workspaceId)
    .where('project_id', '=', context.projectId)
    .where('id', 'in', ids)
    .execute();
  if (rows.length !== new Set(ids).size) throw notFound('Action');
  return rows.map((row) => row.target_label);
}

async function actionLabel(context: PreviewContext, actionId: string) {
  const action = await context.db
    .selectFrom('actions')
    .select('target_label')
    .where('workspace_id', '=', context.workspaceId)
    .where('project_id', '=', context.projectId)
    .where('id', '=', actionId)
    .executeTakeFirst();
  return action?.target_label || 'the Action';
}

const STATUS_VERBS = {
  in_progress: 'Accept',
  dismissed: 'Decline',
  open: 'Restore',
} as const satisfies Record<z.infer<typeof actionUserStatusSchema>, string>;

const declarationKey = (changeId: string) => `mcp:${changeId}`;

export const actionKinds = {
  update_action_status: changeKind({
    permission: ACTIONS_WRITE,
    purpose:
      'accept an Action (in_progress), decline it (dismissed) or restore a declined one (open)',
    payload: z.strictObject({ action_id: z.uuid(), status: actionUserStatusSchema }),
    async execute(trx, _config, actor, change, payload) {
      await setActionStatus(trx, actor, change.projectId, payload.action_id, payload.status);
      return { summary: `The Action is now ${payload.status}.` };
    },
    async preview(context, payload) {
      return {
        title: `${STATUS_VERBS[payload.status]} an Action`,
        rows: [{ label: 'Action', value: await actionLabel(context, payload.action_id) }],
        spend: null,
        opens: null,
      };
    },
  }),
  declare_implemented: changeKind({
    permission: ACTIONS_WRITE,
    purpose: 'declare that the work of an open Action is done',
    payload: z.strictObject({
      action_id: z.uuid(),
      declaration: actionDeclarationRequestSchema,
    }),
    async execute(trx, _config, actor, change, payload) {
      const { declaration } = await declareAction(
        trx,
        actor,
        change.projectId,
        payload.action_id,
        payload.declaration,
        { idempotencyKey: declarationKey(change.id) },
      );
      return {
        summary: 'Action declared implemented. CiteLadder checks later evidence against it.',
        declaration: { id: declaration.id },
      };
    },
    async preview(context, payload) {
      return {
        title: 'Mark an Action implemented',
        rows: [
          { label: 'Action', value: await actionLabel(context, payload.action_id) },
          {
            label: 'Live since',
            value: payload.declaration.declared_implemented_at.slice(0, 10),
          },
        ],
        spend: null,
        opens: null,
      };
    },
  }),
  update_actions_status: changeKind({
    permission: ACTIONS_WRITE,
    purpose:
      'accept, decline or restore many Actions at once, by ids or by a filter (one of the two)',
    payload: actionBulkStatusRequestSchema,
    async execute(trx, _config, actor, change, payload) {
      const result = await setActionStatuses(trx, actor, change.projectId, payload);
      return {
        summary: `${plural(result.updated, 'Action')} now ${payload.to}; ${result.skipped} skipped.`,
      };
    },
    async preview(context, payload) {
      const labels = payload.ids ? await projectActionLabels(context, payload.ids) : [];
      return {
        title: payload.ids
          ? `${STATUS_VERBS[payload.to]} ${plural(payload.ids.length, 'Action')}`
          : `${STATUS_VERBS[payload.to]} the matching Actions`,
        rows: payload.ids
          ? labels.map((value) => ({ label: 'Action', value }))
          : [{ label: 'Filter', value: JSON.stringify(payload.filter) }],
        spend: null,
        opens: ACTIONS,
      };
    },
  }),
  analyze_page: changeKind({
    permission: MEMBER_RUN,
    purpose:
      'start an Agent analysis of one content page against chosen prompts of one topic, in a new chat',
    payload: actionAnalyzeRequestSchema,
    async execute(trx, _config, actor, change, payload) {
      const { agentBindings } = await import('../agent/bindings.ts');
      const { store } = await agentBindings(trx);
      const analysis = await analyzePage(
        trx,
        store,
        { workspaceId: actor.workspaceId, projectId: change.projectId, userId: actor.userId },
        payload,
        change.id,
      );
      return {
        summary: 'Started the page analysis in a new chat. It runs on its own.',
        chat: { id: analysis.chatId },
      };
    },
    async preview(context, payload) {
      const page = await context.db
        .selectFrom('site_urls')
        .select('normalized_url')
        .where('workspace_id', '=', context.workspaceId)
        .where('project_id', '=', context.projectId)
        .where('id', '=', payload.site_url_id)
        .executeTakeFirst();
      return {
        title: 'Analyze a page',
        rows: [
          { label: 'Page', value: page?.normalized_url ?? '' },
          { label: 'Prompts', value: String(payload.prompt_ids.length) },
        ],
        spend: 'Agent usage for the analysis, as for a chat message',
        opens: { label: 'Open the Agent', path: '/agent' },
      };
    },
  }),
  reorder_opportunities: changeKind({
    permission: MEMBER_WRITE,
    purpose:
      'set the order of the opportunity queue; expected_version is the version the read returned',
    payload: opportunityOrderUpdateRequestSchema,
    async execute(trx, _config, actor, change, payload) {
      await updateOrder(
        trx,
        { workspaceId: actor.workspaceId, projectId: change.projectId },
        {
          orderedIds: payload.ordered_opportunity_ids,
          expectedVersion: payload.expected_version,
          userId: actor.userId,
        },
      );
      return { summary: 'Reordered the opportunity queue.' };
    },
    async preview(context, payload) {
      const ids = payload.ordered_opportunity_ids;
      const found = ids.length
        ? await context.db
            .selectFrom('opportunities')
            .select(['id', 'title'])
            .where('workspace_id', '=', context.workspaceId)
            .where('project_id', '=', context.projectId)
            .where('id', 'in', ids)
            .execute()
        : [];
      const title = new Map(found.map((row) => [row.id, row.title]));
      return {
        title: `Reorder ${plural(ids.length, 'opportunity', 'opportunities')}`,
        rows: ids.map((id, index) => ({ label: String(index + 1), value: title.get(id) ?? '' })),
        spend: null,
        opens: null,
      };
    },
  }),
};
