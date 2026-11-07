import { randomUUID } from 'node:crypto';

import {
  buyerPromptGenerateRequestSchema,
  buyerPromptManualRequestSchema,
} from '@citeladder/contracts/commerce-requests';
import { sql } from 'kysely';
import { z } from 'zod';

import { budget, spendBudget } from '../abuse/usage.ts';
import { policy } from '../config.ts';
import { commerceBuyerPromptSystem } from '../config/commerce.ts';
import type { Database } from '../db/database.ts';
import { meterFor, type Meter } from '../models/metering.ts';
import { record, strings } from '../db/json.ts';
import { ApiError } from '../errors.ts';
import { firstOf, isNonEmpty } from '../lists.ts';
import { failureFacts, getLogger } from '../logging.ts';
import { createModelGateway, type ModelGateway } from '../models/gateway.ts';
import { ModelError } from '../models/http.ts';
import { bindingTokens } from '../prompts/binding.ts';
import { insertPrompts } from '../prompts/insert.ts';
import { acquireProjectLock } from '../prompts/locks.ts';
import { promptTextHash } from '../prompts/normalization.ts';
import { buyerPrompts, commerceMissing, type CommerceScope } from './reads.ts';

const P = policy.commerce.buyer_prompts;
const COMMERCE_SET_NAME = 'Commerce Buyer Prompts';
const stringField = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const targetSchema = z.object({ kind: z.enum(['product', 'category']), id: z.uuid() });
type Target = z.infer<typeof targetSchema>;
export const buyerGenerateInput = buyerPromptGenerateRequestSchema.extend({
  count: z.number().int().min(P.min).max(P.max).default(P.default),
});
export const buyerManualInput = buyerPromptManualRequestSchema.extend({
  text: z.string().trim().min(1).max(policy.prompts.text_max_chars),
});
const unavailable = () =>
  new ApiError(503, 'The configured model returned unusable buyer prompts', {
    code: 'commerce_prompt_generation_unavailable',
  });

async function targetContext(db: Database, scope: CommerceScope, target: Target) {
  const project = await db
    .selectFrom('projects')
    .selectAll()
    .where('id', '=', scope.projectId)
    .where('workspace_id', '=', scope.workspaceId)
    .executeTakeFirst();
  if (!project) commerceMissing('Project not found');
  const table = target.kind === 'product' ? 'commerce_products' : 'commerce_categories';
  const row = await db
    .selectFrom(table)
    .selectAll()
    .where('id', '=', target.id)
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .executeTakeFirst();
  if (!row) commerceMissing('Commerce target not found');
  const profile = await db
    .selectFrom('brand_profiles')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .executeTakeFirst();
  const business = record(profile?.business_context);
  const products =
    target.kind === 'category'
      ? await db
          .selectFrom('commerce_products as p')
          .innerJoin('commerce_product_categories as pc', 'pc.product_id', 'p.id')
          .select('p.name')
          .where('pc.category_id', '=', target.id)
          .where('p.workspace_id', '=', scope.workspaceId)
          .where('p.project_id', '=', scope.projectId)
          .where('p.lifecycle_state', '=', 'active')
          .orderBy('p.name')
          .limit(P.product_limit)
          .execute()
      : [];
  return {
    target_kind: target.kind,
    name: row.name,
    brand: project.brand_name,
    locale: [project.language_code, project.country_code].filter(Boolean).join('-'),
    sells: stringField(business.category),
    category_terms: strings(business.category_terms).slice(0, P.term_limit),
    business_model: stringField(business.business_model),
    audience: profile?.target_audience ?? '',
    products_on_this_shelf: products.map((product) => product.name),
    ...(target.kind === 'product'
      ? {
          description: row.description,
          attributes: 'attributes' in row ? row.attributes : {},
          price: 'price' in row ? row.price : null,
          currency: 'currency' in row ? row.currency : '',
        }
      : { category_url: row.canonical_url, category_role: 'role' in row ? row.role : '' }),
  };
}
type TargetContext = Awaited<ReturnType<typeof targetContext>>;

/** `tracked` holds normalized hashes already in the set or kept for this request. */
function admittedTexts(texts: string[], context: TargetContext, tracked: Set<string>) {
  const words = (text: string) => text.toLowerCase().match(/[a-z0-9']+/gu) ?? [];
  const vocabulary = new Set(
    [
      context.sells,
      ...context.category_terms,
      ...context.products_on_this_shelf,
      // A category's own name ("trail running shoes") is what its buyers type.
      context.name,
      ...(context.target_kind === 'product' && 'description' in context
        ? [context.description]
        : []),
    ].flatMap((value) => [...bindingTokens(value)]),
  );
  const admitted: string[] = [],
    seen = new Set<string>(),
    openings = new Map<string, number>();
  for (const raw of texts) {
    const text = raw.trim().replace(/\s+/gu, ' '),
      lower = text.toLowerCase(),
      parts = words(text),
      key = parts.join(' '),
      opening = parts.slice(0, 3).join(' ');
    const hash = promptTextHash(text);
    if (
      text.length > policy.prompts.text_max_chars ||
      parts.length < P.min_words ||
      parts.length > P.max_words ||
      P.survey_markers.some((marker) => lower.includes(marker)) ||
      seen.has(key) ||
      tracked.has(hash) ||
      (openings.get(opening) ?? 0) >= 2
    )
      continue;
    if (vocabulary.size && ![...bindingTokens(text)].some((token) => vocabulary.has(token)))
      continue;
    if (
      [context.brand, ...(context.target_kind === 'product' ? [context.name] : [])].some(
        (name) => name.trim() && lower.includes(name.trim().toLowerCase()),
      )
    )
      continue;
    admitted.push(text);
    seen.add(key);
    openings.set(opening, (openings.get(opening) ?? 0) + 1);
  }
  return admitted;
}

const findCommerceSet = (db: Database, scope: CommerceScope) =>
  db
    .selectFrom('prompt_sets')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('name', '=', COMMERCE_SET_NAME)
    .executeTakeFirst();

async function commerceSet(trx: Database, scope: CommerceScope, now: Date) {
  return (
    (await findCommerceSet(trx, scope)) ??
    trx
      .insertInto('prompt_sets')
      .values({
        id: randomUUID(),
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        name: COMMERCE_SET_NAME,
        description: 'Reviewed buyer-intent prompts linked to Commerce targets.',
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
  );
}

/** The case-insensitive topic index is the final guard against a racing insert. */
async function commerceTopic(trx: Database, scope: CommerceScope, name: string, now: Date) {
  const find = () =>
    trx
      .selectFrom('topics')
      .selectAll()
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where(sql<string>`lower(name)`, '=', name.toLowerCase());
  const topic = await find().executeTakeFirst();
  if (topic) return topic;
  await trx
    .insertInto('topics')
    .values({
      id: randomUUID(),
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      parent_id: null,
      name,
      description: 'Commerce target-bound buyer intent',
      origin: 'generated',
      created_at: now,
      updated_at: now,
    })
    .onConflict((conflict) => conflict.doNothing())
    .execute();
  return find().executeTakeFirstOrThrow();
}

type Batch = { target: Target; texts: string[]; evidence: Record<string, unknown> | null };

/**
 * One batch's disabled prompts and their target bindings; a normalized
 * duplicate is a 409.
 */
async function insertBatch(
  trx: Database,
  scope: CommerceScope,
  owner: {
    set: { id: string; project_id: string; workspace_id: string };
    topic: string;
    name: string;
  },
  batch: Batch,
  now: Date,
) {
  const labels = batch.evidence
    ? { theme: owner.name, buyer_stage: 'consideration', prompt_intent: 'recommend' }
    : { theme: 'Commerce', buyer_stage: '', prompt_intent: '' };
  const prompts = await insertPrompts(
    trx,
    owner.set,
    batch.texts.map((text) => ({
      text,
      topic_id: owner.topic,
      ...labels,
      intent: 'comparison',
      persona: '',
      cohort: 'commerce',
      enabled: false,
      generation_evidence: batch.evidence,
    })),
    { origin: batch.evidence ? 'generated' : 'manual', onDuplicate: 'reject' },
  );
  const ids = prompts.flatMap((prompt) => (prompt === null ? [] : [prompt.id]));
  if (isNonEmpty(ids))
    await trx
      .insertInto('commerce_prompt_targets')
      .values(
        ids.map((id) => ({
          id: randomUUID(),
          workspace_id: scope.workspaceId,
          project_id: scope.projectId,
          prompt_id: id,
          target_kind: batch.target.kind,
          target_id: batch.target.id,
          template_version: P.version,
          approved_at: null,
          created_at: now,
        })),
      )
      .execute();
  return ids;
}

function persist(db: Database, scope: CommerceScope, batches: Batch[]) {
  return db.transaction().execute(async (trx) => {
    const contexts = [];
    for (const batch of batches) contexts.push(await targetContext(trx, scope, batch.target)); // NOSONAR -- One transaction: statements run in order.
    // The project lock first, as every prompt writer: the set and topics below are created under it.
    await acquireProjectLock(trx, scope.projectId);
    const now = new Date();
    const set = await commerceSet(trx, scope, now);
    const ids: string[] = [];
    for (const [index, batch] of batches.entries()) {
      const name = contexts[index]!.name.trim()
        .replaceAll(/\s+/gu, ' ')
        .slice(0, policy.prompts.topic_name_max_chars)
        .trim();
      if (!name) throw unavailable();
      const topic = await commerceTopic(trx, scope, name, now); // NOSONAR -- One transaction: statements run in order.
      ids.push(
        ...(await /* NOSONAR -- One transaction; ids keep generation order. */ insertBatch(
          trx,
          scope,
          { set, topic: topic.id, name },
          batch,
          now,
        )),
      );
    }
    // Same-timestamp rows read back in random-id order; return generation order.
    const views = new Map((await buyerPrompts(trx, scope)).map((row) => [row.id, row]));
    return ids.flatMap((id) => views.get(id) ?? []);
  });
}

export async function manualBuyerPrompt(
  db: Database,
  scope: CommerceScope,
  input: z.infer<typeof buyerManualInput>,
) {
  const rows = await persist(db, scope, [
    { target: input.target, texts: [input.text], evidence: null },
  ]);
  return firstOf(rows, 'the persisted manual buyer prompt');
}

async function trackedHashes(db: Database, scope: CommerceScope) {
  const set = await findCommerceSet(db, scope);
  if (!set) return new Set<string>();
  const rows = await db
    .selectFrom('prompts')
    .select('normalized_text_hash')
    .where('prompt_set_id', '=', set.id)
    .execute();
  return new Set(rows.map((row) => row.normalized_text_hash));
}
function createGateway(factory: () => ModelGateway) {
  try {
    return factory();
  } catch (error) {
    if (error instanceof ModelError) throw unavailable();
    throw error;
  }
}

export async function generateBuyerPrompts(
  db: Database,
  scope: CommerceScope,
  input: z.infer<typeof buyerGenerateInput>,
  gatewayFactory: () => ModelGateway = createModelGateway,
  meter: Meter = meterFor(db, scope.workspaceId),
) {
  const contexts = [];
  for (const target of input.targets) contexts.push(await targetContext(db, scope, target));
  // Skip already tracked texts so a repeat generation is not a 409; the
  // unique normalized hash still guards writes that race this read.
  const tracked = await trackedHashes(db, scope);
  const gateway = meter.gateway(createGateway(gatewayFactory), 'commerce_buyer_prompts');
  await spendBudget(db, budget('agent_provider_call', process.env), scope.workspaceId, {
    amount: input.targets.length,
  });
  // Each target keeps what it admitted, so one weak batch or a later model
  // failure does not discard the prompts already paid for. Only a request that
  // admitted nothing at all is unavailable.
  const batches = [];
  for (const [index, context] of contexts.entries()) {
    let response;
    const startedAt = performance.now();
    try {
      response = await gateway.structured(
        commerceBuyerPromptSystem(context.business_model),
        JSON.stringify({ count: input.count, context }),
        // Unusable items are dropped one by one during admission, never the batch.
        z.object({ prompts: z.array(z.object({ text: z.string() })) }),
      );
    } catch (error) {
      if (!(error instanceof ModelError)) throw error;
      getLogger('commerce.buyer_prompts').warning('commerce_buyer_prompts_model_failed', {
        target_index: index,
        admitted_batches: batches.length,
        ...failureFacts(error),
        status: error.status,
        elapsed_ms: Math.round(performance.now() - startedAt),
      });
      break;
    }
    const texts = admittedTexts(
      response.value.prompts.map((row) => row.text),
      context,
      tracked,
    ).slice(0, input.count);
    if (!texts.length) continue;
    for (const kept of texts) tracked.add(promptTextHash(kept));
    const target = input.targets[index]!;
    const { content: _content, ...model } = response.result;
    batches.push({ target, texts, evidence: { target, template_version: P.version, model } });
  }
  if (!batches.length) throw unavailable();
  return persist(db, scope, batches);
}
