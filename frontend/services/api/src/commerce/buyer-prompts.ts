import { createHash, randomUUID } from 'node:crypto';

import {
  buyerPromptGenerateRequestSchema,
  buyerPromptManualRequestSchema,
} from '@citeladder/contracts/commerce-requests';
import { buyerStageSchema, type BuyerStage } from '@citeladder/contracts/project';
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
  /** Prompts per hero product; a category's size is its configured matrix. */
  count: z.number().int().min(P.min).max(P.max).default(P.default),
  /** The caller picked the product targets as hero products. */
  hero: z.boolean().default(false),
});
const M = P.matrix;
const matrixCells = M.contexts * M.stages.length;
/** Branded prompts that keep `branded_share` of a batch with `organic` non-branded ones. */
const brandedQuota = (organic: number) =>
  Math.floor((organic * M.branded_share) / (1 - M.branded_share));
/** One admitted prompt and the matrix cell it fills (empty outside a category matrix). */
type Draft = { text: string; context: string; stage: BuyerStage; branded: boolean };
const plainDraft = (text: string): Draft => ({ text, context: '', stage: '', branded: false });
const heroRequired = () =>
  new ApiError(422, 'Product prompts are generated only for hero products you pick', {
    code: 'commerce_prompt_hero_required',
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

/** The tokens a prompt must share with its target to be about it. */
function targetVocabulary(context: TargetContext) {
  return new Set(
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
}

/** A buyer's prompt in length and register, before any target or brand rule. */
function wellFormed(text: string, parts: readonly string[]) {
  const lower = text.toLowerCase();
  return (
    text.length <= policy.prompts.text_max_chars &&
    parts.length >= P.min_words &&
    parts.length <= P.max_words &&
    !P.survey_markers.some((marker) => lower.includes(marker))
  );
}

/**
 * `branded` rows are the bounded exception to the owned-name rejection: they
 * must name the owned brand. Every other row must bind to the target and name
 * neither the brand nor, for a product, the product itself.
 */
function fitsBrandRule(
  text: string,
  context: TargetContext,
  vocabulary: ReadonlySet<string>,
  branded: boolean,
) {
  const lower = text.toLowerCase();
  if (branded) {
    const brand = context.brand.trim().toLowerCase();
    return brand !== '' && lower.includes(brand);
  }
  if (vocabulary.size && ![...bindingTokens(text)].some((token) => vocabulary.has(token)))
    return false;
  const owned = [context.brand, ...(context.target_kind === 'product' ? [context.name] : [])];
  return !owned.some((name) => name.trim() && lower.includes(name.trim().toLowerCase()));
}

/** `tracked` holds normalized hashes already in the set or kept for this request. */
function admittedTexts<T extends { text: string }>(
  rows: T[],
  context: TargetContext,
  tracked: Set<string>,
  branded = false,
): T[] {
  const words = (text: string) => text.toLowerCase().match(/[a-z0-9']+/gu) ?? [];
  const vocabulary = targetVocabulary(context);
  const admitted: T[] = [],
    seen = new Set<string>(),
    openings = new Map<string, number>();
  for (const row of rows) {
    const text = row.text.trim().replace(/\s+/gu, ' '),
      parts = words(text),
      key = parts.join(' '),
      opening = parts.slice(0, 3).join(' ');
    if (
      !wellFormed(text, parts) ||
      seen.has(key) ||
      tracked.has(promptTextHash(text)) ||
      (openings.get(opening) ?? 0) >= 2 ||
      !fitsBrandRule(text, context, vocabulary, branded)
    )
      continue;
    admitted.push({ ...row, text });
    seen.add(key);
    openings.set(opening, (openings.get(opening) ?? 0) + 1);
  }
  return admitted;
}

const matrixRowSchema = z.object({
  text: z.string(),
  context: z.string().default(''),
  stage: z.string().default(''),
  branded: z.boolean().default(false),
});
type MatrixRow = z.infer<typeof matrixRowSchema>;

/**
 * A category's matrix: at most one non-branded prompt per context × stage
 * cell and at most the configured number of contexts, then the branded
 * comparisons the share allows for what was admitted.
 */
function matrixDrafts(rows: MatrixRow[], context: TargetContext, tracked: Set<string>): Draft[] {
  const stages = new Set<string>(M.stages);
  const label = (value: string) =>
    value.trim().replaceAll(/\s+/gu, ' ').slice(0, M.context_max_chars);
  const organicRows = rows
    .filter((row) => !row.branded && label(row.context) && stages.has(row.stage))
    .map((row) => ({ ...row, context: label(row.context) }));
  const contexts = new Set<string>(),
    cells = new Set<string>(),
    organic: Draft[] = [];
  for (const row of admittedTexts(organicRows, context, tracked)) {
    const key = row.context.toLowerCase(),
      cell = `${key}|${row.stage}`;
    if (cells.has(cell) || (!contexts.has(key) && contexts.size >= M.contexts)) continue;
    contexts.add(key);
    cells.add(cell);
    organic.push({ ...row, stage: buyerStageSchema.parse(row.stage), branded: false });
  }
  const brandedRows = rows.filter((row) => row.branded && stages.has(row.stage));
  const branded = admittedTexts(brandedRows, context, tracked, true)
    .slice(0, brandedQuota(organic.length))
    .map((row): Draft => ({
      ...row,
      context: '',
      stage: buyerStageSchema.parse(row.stage),
      branded: true,
    }));
  return [...organic, ...branded];
}

/** The model request for one target: a category's matrix, or a hero product's count. */
function generationRequest(context: TargetContext, count: number) {
  return context.target_kind === 'category'
    ? { contexts: M.contexts, stages: M.stages, branded: brandedQuota(matrixCells), context }
    : { count, context };
}

/** One target's admitted drafts from the model's rows. */
function targetDrafts(
  rows: MatrixRow[],
  context: TargetContext,
  tracked: Set<string>,
  count: number,
): Draft[] {
  if (context.target_kind === 'category') return matrixDrafts(rows, context, tracked);
  return admittedTexts(rows, context, tracked)
    .slice(0, count)
    .map((row) => plainDraft(row.text));
}

/** Generated prompts carry the target's theme and the draft's stage and intent; manual ones none. */
function promptLabels(draft: Draft, themeName: string | null) {
  if (themeName === null) return { theme: 'Commerce', buyer_stage: '', prompt_intent: '' };
  return {
    theme: themeName,
    buyer_stage: draft.stage || 'consideration',
    prompt_intent: draft.branded ? 'compare' : 'recommend',
  };
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

type Batch = { target: Target; drafts: Draft[]; evidence: Record<string, unknown> | null };

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
  const themeName = batch.evidence === null ? null : owner.name;
  const prompts = await insertPrompts(
    trx,
    owner.set,
    batch.drafts.map((draft) => ({
      text: draft.text,
      topic_id: owner.topic,
      ...promptLabels(draft, themeName),
      intent: 'comparison',
      persona: draft.context,
      // The comparison cohort is the shared branded one: its prompts stay out of organic metrics.
      cohort: draft.branded ? 'comparison' : 'commerce',
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

function persist(
  db: Database,
  scope: CommerceScope,
  batches: Batch[],
  keyed: { key: string; input: GenerateInput } | null = null,
) {
  return db.transaction().execute(async (trx) => {
    const contexts = [];
    for (const batch of batches) contexts.push(await targetContext(trx, scope, batch.target)); // NOSONAR -- One transaction: statements run in order.
    // The project lock first, as every prompt writer: the set and topics below are created under it.
    await acquireProjectLock(trx, scope.projectId);
    // A concurrent repeat of the same key persists once; the later one replays it.
    const prior = keyed ? await replayGeneration(trx, scope, keyed.input, keyed.key) : null;
    if (prior) return prior;
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
    { target: input.target, drafts: [plainDraft(input.text)], evidence: null },
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

type GenerateInput = z.infer<typeof buyerGenerateInput>;

/** The request a keyed generation ran, as a hash its prompts' evidence keeps. */
function requestHash(input: GenerateInput): string {
  const request = {
    targets: input.targets.map((target) => ({ kind: target.kind, id: target.id })),
    count: input.count,
    hero: input.hero,
  };
  return createHash('sha256').update(JSON.stringify(request)).digest('hex');
}

/**
 * The prompts an earlier generation with this key persisted, from stored rows
 * only, or null when none did. The same key with another request is a 409.
 */
async function replayGeneration(
  db: Database,
  scope: CommerceScope,
  input: GenerateInput,
  key: string,
) {
  const set = await findCommerceSet(db, scope);
  if (!set) return null;
  const rows = await db
    .selectFrom('prompts')
    .select(['id', 'generation_evidence'])
    .where('prompt_set_id', '=', set.id)
    .where(sql<string>`generation_evidence->>'idempotency_key'`, '=', key)
    .execute();
  if (!rows.length) return null;
  const hash = requestHash(input);
  if (rows.some((row) => record(row.generation_evidence).request_hash !== hash))
    throw new ApiError(409, 'Idempotency-Key was used for another generation request', {
      code: 'generation_idempotency_conflict',
    });
  const ids = new Set(rows.map((row) => row.id));
  return (await buyerPrompts(db, scope)).filter((row) => ids.has(row.id));
}

/**
 * One target's model answer, or null after a provider failure, which is logged
 * with where the generation stopped.
 */
async function askModel(
  gateway: ModelGateway,
  context: TargetContext,
  count: number,
  progress: { target_index: number; admitted_batches: number },
) {
  const startedAt = performance.now();
  try {
    return await gateway.structured(
      commerceBuyerPromptSystem(context.business_model, context.target_kind === 'category'),
      JSON.stringify(generationRequest(context, count)),
      // Unusable items are dropped one by one during admission, never the batch.
      z.object({ prompts: z.array(matrixRowSchema) }),
    );
  } catch (error) {
    if (!(error instanceof ModelError)) throw error;
    getLogger('commerce.buyer_prompts').warning('commerce_buyer_prompts_model_failed', {
      ...progress,
      ...failureFacts(error),
      status: error.status,
      elapsed_ms: Math.round(performance.now() - startedAt),
    });
    return null;
  }
}

/** Each requested target's context, in request order, once the request may name them. */
async function requestContexts(db: Database, scope: CommerceScope, input: GenerateInput) {
  // Per-product prompts are an explicit hero choice; every other product is
  // covered by its category's matrix.
  if (!input.hero && input.targets.some((target) => target.kind === 'product'))
    throw heroRequired();
  const contexts = [];
  for (const target of input.targets) contexts.push(await targetContext(db, scope, target)); // NOSONAR -- The first unavailable target, in request order, is the error.
  return contexts;
}

type GenerateOptions = {
  gatewayFactory?: () => ModelGateway;
  meter?: Meter;
  /** Names the first attempt; a retry with the same key replays its stored prompts. */
  idempotencyKey?: string | null;
};

/**
 * Generate disabled buyer prompts for the targets. With `idempotencyKey`, a
 * retry of a generation that already persisted prompts returns those prompts
 * without another model call or budget spend.
 */
export async function generateBuyerPrompts(
  db: Database,
  scope: CommerceScope,
  input: GenerateInput,
  {
    gatewayFactory = createModelGateway,
    meter = meterFor(db, scope.workspaceId),
    idempotencyKey = null,
  }: GenerateOptions = {},
) {
  const contexts = await requestContexts(db, scope, input);
  // Targets are authorized before revealing whether the key was used.
  if (idempotencyKey) {
    const prior = await replayGeneration(db, scope, input, idempotencyKey);
    if (prior) return prior;
  }
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
  const keyed = idempotencyKey
    ? { idempotency_key: idempotencyKey, request_hash: requestHash(input) }
    : {};
  const batches = [];
  for (const [index, context] of contexts.entries()) {
    const response = await askModel(gateway, context, input.count, {
      target_index: index,
      admitted_batches: batches.length,
    });
    if (!response) break;
    const drafts = targetDrafts(response.value.prompts, context, tracked, input.count);
    if (!drafts.length) continue;
    for (const kept of drafts) tracked.add(promptTextHash(kept.text));
    const target = input.targets[index]!;
    const { content: _content, ...model } = response.result;
    batches.push({
      target,
      drafts,
      evidence: { target, template_version: P.version, model, ...keyed },
    });
  }
  if (!batches.length) throw unavailable();
  return persist(db, scope, batches, idempotencyKey ? { key: idempotencyKey, input } : null);
}
