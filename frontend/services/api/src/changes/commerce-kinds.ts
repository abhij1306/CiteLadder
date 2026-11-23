import {
  buyerPromptDecisionRequestSchema,
  competitorDecisionRequestSchema,
  productLifecycleRequestSchema,
} from '@citeladder/contracts/commerce-requests';
import { z } from 'zod';
import {
  buyerGenerateInput,
  buyerManualInput,
  generateBuyerPrompts,
  manualBuyerPrompt,
  requestContexts,
} from '../commerce/buyer-prompts.ts';
import { decideBuyerPrompt, decideCandidate } from '../commerce/decisions.ts';
import { discoveryInput, enqueueDiscoveries } from '../commerce/discovery.ts';
import { editProduct, productEditInput, setProductLifecycle } from '../commerce/edits.ts';
import { commerceMissing, type CommerceScope } from '../commerce/reads.ts';
import { changeKind, MEMBER_RUN, MEMBER_WRITE, plural, type PreviewContext } from './kind.ts';

type Target = Readonly<{ kind: 'product' | 'category'; id: string }>;

const PRODUCTS = { label: 'Open Products', path: '/products' };

function commerceScope(workspaceId: string, change: { projectId: string }) {
  return { workspaceId, projectId: change.projectId } satisfies CommerceScope;
}

async function targetNames(context: PreviewContext, targets: readonly Target[]) {
  const names = new Map<string, string>();
  for (const table of ['commerce_products', 'commerce_categories'] as const) {
    const ids = targets
      .filter((target) => (target.kind === 'product') === (table === 'commerce_products'))
      .map((target) => target.id);
    if (!ids.length) continue;
    const rows = await context.db // NOSONAR
      .selectFrom(table)
      .select(['id', 'name'])
      .where('workspace_id', '=', context.workspaceId)
      .where('project_id', '=', context.projectId)
      .where('id', 'in', ids)
      .execute();
    for (const row of rows) names.set(row.id, row.name);
  }
  return targets.map((target) => names.get(target.id) ?? '');
}

async function product(context: PreviewContext, id: string) {
  const row = await context.db
    .selectFrom('commerce_products')
    .selectAll()
    .where('workspace_id', '=', context.workspaceId)
    .where('project_id', '=', context.projectId)
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) commerceMissing('Product not found');
  return row;
}

function shown(value: unknown) {
  if (value === null || value === undefined || value === '') return 'empty';
  if (Array.isArray(value)) return value.join(', ') || 'none';
  return String(value);
}

async function buyerPromptText(context: PreviewContext, id: string) {
  const row = await context.db
    .selectFrom('prompts as p')
    .innerJoin('commerce_prompt_targets as t', 't.prompt_id', 'p.id')
    .select(['p.text', 'p.enabled'])
    .where('t.workspace_id', '=', context.workspaceId)
    .where('t.project_id', '=', context.projectId)
    .where('p.id', '=', id)
    .executeTakeFirst();
  if (!row) commerceMissing('Buyer prompt not found');
  return row;
}

export const commerceKinds = {
  discover_commerce_competitors: changeKind({
    permission: MEMBER_RUN,
    purpose:
      'search for competing products of chosen products or categories; uses daily discoveries as each runs',
    payload: discoveryInput,
    async execute(trx, _config, actor, change, payload) {
      const scope = commerceScope(actor.workspaceId, change);
      const { task_ids: tasks } = await enqueueDiscoveries(trx, scope, payload);
      return {
        summary: `Queued ${plural(tasks.length, 'competitor discovery', 'competitor discoveries')}. They run on their own.`,
      };
    },
    async preview(context, payload) {
      const names = await targetNames(context, payload.targets);
      return {
        title: `Discover competitors for ${plural(payload.targets.length, 'target')}`,
        rows: payload.targets.map((target, index) => ({
          label: target.kind,
          value: names[index] ?? '',
        })),
        spend: `${plural(payload.targets.length, 'competitor discovery', 'competitor discoveries')} from the day's allowance; no AI credits`,
        opens: PRODUCTS,
      };
    },
  }),
  generate_buyer_prompts: changeKind({
    permission: MEMBER_RUN,
    purpose:
      'have CiteLadder write buyer prompts for categories or hero products; then they wait for approval',
    payload: buyerGenerateInput,
    async live(trx, _config, actor, change, payload) {
      await requestContexts(trx, commerceScope(actor.workspaceId, change), payload);
    },
    async execute(db, _config, actor, change, payload) {
      const scope = commerceScope(actor.workspaceId, change);
      const written = await generateBuyerPrompts(db, scope, payload, { idempotencyKey: change.id });
      return { summary: `Wrote ${plural(written.length, 'buyer prompt')} for approval.` };
    },
    async preview(context, payload) {
      const scope = commerceScope(context.workspaceId, context);
      await requestContexts(context.db, scope, payload);
      return {
        title: `Write buyer prompts for ${plural(payload.targets.length, 'target')}`,
        rows: [
          { label: 'Targets', value: (await targetNames(context, payload.targets)).join(', ') },
          { label: 'Prompts each', value: `Up to ${payload.count}` },
        ],
        spend: `Up to ${plural(payload.targets.length, 'model call')} on your own model key`,
        opens: PRODUCTS,
      };
    },
  }),
  add_buyer_prompt: changeKind({
    permission: MEMBER_WRITE,
    purpose: 'add a buyer prompt the person wrote for a product or category; it waits for approval',
    payload: buyerManualInput,
    async execute(trx, _config, actor, change, payload) {
      const created = await manualBuyerPrompt(
        trx,
        commerceScope(actor.workspaceId, change),
        payload,
      );
      return { summary: `Added the buyer prompt “${created.text}”.` };
    },
    async preview(context, payload) {
      const [target] = await targetNames(context, [payload.target]);
      return {
        title: 'Add a buyer prompt',
        rows: [
          { label: payload.target.kind, value: target ?? '' },
          { label: 'Prompt', value: payload.text },
        ],
        spend: null,
        opens: null,
      };
    },
  }),
  edit_product: changeKind({
    permission: MEMBER_WRITE,
    purpose:
      'correct catalog fields of a product (name, brand, description, price, currency, URLs, ids, categories) with values the person gave',
    payload: z.strictObject({ product_id: z.uuid(), edit: productEditInput }),
    async execute(trx, _config, actor, change, payload) {
      const scope = commerceScope(actor.workspaceId, change);
      const edited = await editProduct(trx, scope, payload.product_id, payload.edit);
      return { summary: `Updated the product “${edited.name}”.` };
    },
    async preview(context, payload) {
      const row = await product(context, payload.product_id);
      const current: Record<string, unknown> = row;
      return {
        title: 'Edit a product',
        rows: [
          { label: 'Product', value: row.name },
          ...Object.entries(payload.edit).map(([field, value]) => ({
            label: field.replaceAll('_', ' '),
            value:
              field === 'categories'
                ? `Replaced by ${shown(value)}`
                : `${shown(current[field])} → ${shown(value)}`,
          })),
        ],
        spend: null,
        opens: null,
      };
    },
  }),
  set_product_lifecycle: changeKind({
    permission: MEMBER_WRITE,
    purpose: 'archive a product or make it active again',
    payload: z.strictObject({ product_id: z.uuid(), ...productLifecycleRequestSchema.shape }),
    async execute(trx, _config, actor, change, payload) {
      const scope = commerceScope(actor.workspaceId, change);
      await setProductLifecycle(trx, scope, payload.product_id, payload.lifecycle_state);
      return { summary: `The product is now ${payload.lifecycle_state}.` };
    },
    async preview(context, payload) {
      const row = await product(context, payload.product_id);
      return {
        title: payload.lifecycle_state === 'archived' ? 'Archive a product' : 'Restore a product',
        rows: [
          { label: 'Product', value: row.name },
          { label: 'Now', value: row.lifecycle_state },
          { label: 'After', value: payload.lifecycle_state },
        ],
        spend: null,
        opens: null,
      };
    },
  }),
  decide_competitor_candidate: changeKind({
    permission: MEMBER_WRITE,
    purpose: 'approve or reject a discovered competing product',
    payload: z.strictObject({ candidate_id: z.uuid(), ...competitorDecisionRequestSchema.shape }),
    async execute(trx, _config, actor, change, payload) {
      const scope = commerceScope(actor.workspaceId, change);
      const decided = await decideCandidate(trx, scope, payload.candidate_id, payload.decision);
      return { summary: `Marked “${decided.product_name}” ${payload.decision}.` };
    },
    async preview(context, payload) {
      const row = await context.db
        .selectFrom('commerce_competitor_candidates')
        .select(['product_name', 'brand_name', 'canonical_url', 'state'])
        .where('workspace_id', '=', context.workspaceId)
        .where('project_id', '=', context.projectId)
        .where('id', '=', payload.candidate_id)
        .executeTakeFirst();
      if (!row) commerceMissing('Competitor candidate not found');
      return {
        title: payload.decision === 'approved' ? 'Approve a competitor' : 'Reject a competitor',
        rows: [
          { label: 'Product', value: `${row.product_name} · ${row.brand_name}` },
          { label: 'Page', value: row.canonical_url },
          { label: 'Now', value: row.state },
        ],
        spend: null,
        opens: null,
      };
    },
  }),
  decide_buyer_prompt: changeKind({
    permission: MEMBER_WRITE,
    purpose: 'approve a buyer prompt so audits ask it, or withdraw the approval (approved false)',
    payload: z.strictObject({ prompt_id: z.uuid(), ...buyerPromptDecisionRequestSchema.shape }),
    async execute(trx, _config, actor, change, payload) {
      const scope = commerceScope(actor.workspaceId, change);
      await decideBuyerPrompt(trx, scope, payload.prompt_id, payload.approved);
      return {
        summary: payload.approved ? 'Approved the buyer prompt.' : 'Withdrew the approval.',
      };
    },
    async preview(context, payload) {
      const row = await buyerPromptText(context, payload.prompt_id);
      return {
        title: payload.approved ? 'Approve a buyer prompt' : 'Withdraw a buyer prompt',
        rows: [
          { label: 'Prompt', value: row.text },
          { label: 'Now', value: row.enabled ? 'approved' : 'waiting' },
        ],
        spend: null,
        opens: null,
      };
    },
  }),
};
