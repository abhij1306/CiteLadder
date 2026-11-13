import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Insertable, Selectable } from 'kysely';
import type { SettingSource } from '../config/settings.ts';
import type { Database } from '../db/database.ts';
import type {
  Audits,
  CommerceCompetitorCandidates,
  CommerceRecommendationObservations,
} from '../generated/db-schema.ts';
import { parseShoppingResults, type ShoppingResult } from '../search-surfaces/parsing.ts';
import { record, strings } from '../db/json.ts';
import type { AuditTask } from '../queue/audit-queue.ts';
import type { DeriveExecution, ExecutionResult } from '../audits/result-persistence.ts';
import { deriveExecution } from '../audits/derivation.ts';
import { auditPolicy } from '../audits/config.ts';
import { createModelGateway, gatewaySettings } from '../models/gateway.ts';
import { budget, spendBudget } from '../abuse/usage.ts';
import { meterFor, type Meter } from '../models/metering.ts';
import { lockCatalog } from './catalog-store.ts';
import { loadRevision, type ShelfTargetRef } from './catalog-revisions.ts';
import { ownedHosts } from './discovery-validation.ts';
import {
  boundedText,
  competitorPageUrl,
  frozenTargetSchema,
  matchPageUrl,
  matchRecommendation,
  NO_MATCH,
  observedMerchant,
  observedPrice,
  prepareRecommendations,
  resolvedBatchSchema,
  resolvedCompetitorUrl,
  shelfPolicy,
  type PreparedRecommendation,
  type ShelfCatalog,
  type ShelfMatch,
  type ShelfResolver,
} from './shelf-parsing.ts';

export function frozenShelfIds(frozen: Record<string, unknown>) {
  return strings(frozen.prompt_target_ids).filter((id) => z.uuid().safeParse(id).success);
}
/** The catalog revision an audit froze at admission (`configuration.commerce_catalog`), if any. */
export function frozenRevisionId(configuration: unknown): string | null {
  const parsed = z.uuid().safeParse(record(record(configuration).commerce_catalog).revision_id);
  return parsed.success ? parsed.data : null;
}
/** A resolver that runs its model call under the answer's workspace meter. */
export type MeterableShelfResolver = {
  model: string;
  resolve(spans: string[], meter: Meter): Promise<unknown>;
};
export function configuredShelfResolver(
  env: SettingSource = process.env,
  signal?: AbortSignal,
): MeterableShelfResolver | undefined {
  try {
    const gateway = createModelGateway(gatewaySettings(env));
    return {
      model: gateway.model,
      resolve: async (spans, meter) =>
        (
          await meter
            .gateway(gateway, 'commerce_shelf')
            .structured(
              'Extract only recommended products from these numbered answer spans. For each product, set span to the index of the span that recommends it. Keep product identity separate from merchant and citation URLs. Set product_url only when a URL written in that span identifies the recommended PDP; set merchant_url only for a seller link. Omit any span you are uncertain about.',
              JSON.stringify({ spans: spans.map((text, index) => ({ index, text })) }),
              resolvedBatchSchema,
              signal,
            )
        ).value,
    };
  } catch {
    return undefined;
  }
}

/**
 * Each resolver call spends one unit of the workspace model quota first. An
 * exhausted quota throws inside the resolver, which leaves the answer's spans
 * unresolved instead of failing the execution.
 */
function metered(
  db: Database,
  workspaceId: string,
  resolver: MeterableShelfResolver | null | undefined,
): ShelfResolver | undefined {
  if (!resolver) return undefined;
  return {
    model: resolver.model,
    resolve: async (spans) => {
      await spendBudget(db, budget('agent_provider_call', process.env), workspaceId);
      return resolver.resolve(spans, meterFor(db, workspaceId));
    },
  };
}

type Candidate = Selectable<CommerceCompetitorCandidates>;
/** The columns one shelf slot sets; the rest come from the pass. */
type SlotFields = Omit<
  Insertable<CommerceRecommendationObservations>,
  | 'id'
  | 'workspace_id'
  | 'project_id'
  | 'audit_id'
  | 'task_id'
  | 'artifact_id'
  | 'pass_id'
  | 'target_kind'
  | 'target_id'
  | 'parser_version'
  | 'matcher_version'
  | 'created_at'
>;
type Versions = { parser: string; matcher: string; resolver: string };
/**
 * One derivation of one stored answer: the catalog it is matched against and
 * the target, revision and versions its pass records. A targeted pass keeps
 * every span, as the AI Shelf always has; an untargeted pass (an answer no
 * buyer prompt targets) keeps only spans that name a holder, and every
 * organic carousel card.
 */
export type PassContext = {
  workspaceId: string;
  projectId: string;
  auditId: string;
  taskId: string;
  target: ShelfTargetRef | null;
  catalog: ShelfCatalog;
  revisionId: string | null;
  mode: 'live' | 'backfill';
  versions: Versions;
  owned: string[];
  locale: string;
};
type Pass = PassContext & { passId: string };
/** The stored answer a pass reads: raw text, provider response and citations. */
export type StoredAnswer = {
  artifactId: string;
  answerText: string;
  providerMetadata: unknown;
  citations: unknown;
  capturedAt: Date;
};

async function findOrCreateCandidate(
  db: Database,
  { workspaceId, projectId }: PassContext,
  target: ShelfTargetRef,
  observed: { title: string; brand: string; evidence: Record<string, unknown> },
  url: string,
): Promise<Candidate> {
  const find = () =>
    db
      .selectFrom('commerce_competitor_candidates')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('project_id', '=', projectId)
      .where('target_kind', '=', target.target_kind)
      .where('target_id', '=', target.target_id)
      .where('canonical_url', '=', url)
      .executeTakeFirst();
  const existing = await find();
  if (existing) return existing;
  // Concurrent audit completions serialize new pending candidates on the owning project.
  await lockCatalog(db, { workspaceId, projectId });
  const raced = await find();
  if (raced) return raced;
  return db
    .insertInto('commerce_competitor_candidates')
    .values({
      id: randomUUID(),
      workspace_id: workspaceId,
      project_id: projectId,
      target_kind: target.target_kind,
      target_id: target.target_id,
      canonical_url: url,
      product_name: boundedText(observed.title, 512),
      brand_name: boundedText(observed.brand, 255),
      state: 'pending',
      source_kind: 'ai_observed',
      evidence: JSON.stringify(observed.evidence),
      attempt_id: null,
      decision_at: null,
      created_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}
/**
 * A recommendation matching neither catalog product nor approved competitor
 * may be a new AI-observed competitor of the answer's target; an answer no
 * buyer prompt targets creates none.
 */
async function observedCandidate(
  db: Database,
  ctx: PassContext,
  { span, resolved }: PreparedRecommendation,
  matched: ShelfMatch,
  evidence: { answerText: string; sourceUrls: string[] },
) {
  if (matched.product || matched.competitor || !resolved || !ctx.target) return null;
  const url = resolvedCompetitorUrl(resolved.product_url, {
    answer: evidence.answerText,
    citations: evidence.sourceUrls,
    ownedHosts: ctx.owned,
  });
  if (!url) return null;
  return findOrCreateCandidate(
    db,
    ctx,
    ctx.target,
    {
      title: resolved.title,
      brand: resolved.brand,
      evidence: {
        observation_text: boundedText(span.text, shelfPolicy.span_chars),
        resolved_product_url: url,
        merchant_url: resolved.merchant_url,
      },
    },
    url,
  );
}
/**
 * An AI-observed candidate is classified by its review state when the answer
 * is recorded: approved holds a slot like a frozen competitor, pending is its
 * own class outside the share, and rejected is excluded from the shelf.
 */
function observationClassification(matched: ShelfMatch, candidate: { state: string } | null) {
  if (matched.product) return 'owned';
  if (matched.competitor) return 'approved_competitor';
  if (!candidate) return 'unresolved';
  if (candidate.state === 'approved') return 'approved_competitor';
  return candidate.state === 'rejected' ? 'rejected_competitor' : 'ai_observed_competitor';
}
/** The identity columns of a slot held by a match or an AI-observed candidate. */
function holderFields(
  matched: ShelfMatch,
  candidate: Candidate | null,
  observed: { title: string; brand: string },
) {
  return {
    product_id: matched.product?.id ?? null,
    competitor_candidate_id: matched.competitor?.id ?? candidate?.id ?? null,
    classification: observationClassification(matched, candidate),
    observed_product: boundedText(
      matched.product?.name ??
        matched.competitor?.product_name ??
        candidate?.product_name ??
        observed.title,
      512,
    ),
    observed_brand: boundedText(
      matched.product?.brand ??
        matched.competitor?.brand_name ??
        candidate?.brand_name ??
        observed.brand,
      255,
    ),
    match_confidence: matched.confidence,
  };
}
async function insertObservation(db: Database, pass: Pass, artifactId: string, slot: SlotFields) {
  const id = randomUUID();
  await db
    .insertInto('commerce_recommendation_observations')
    .values({
      id,
      workspace_id: pass.workspaceId,
      project_id: pass.projectId,
      audit_id: pass.auditId,
      task_id: pass.taskId,
      artifact_id: artifactId,
      pass_id: pass.passId,
      target_kind: pass.target?.target_kind ?? null,
      target_id: pass.target?.target_id ?? null,
      parser_version: pass.versions.parser,
      matcher_version: pass.versions.matcher,
      created_at: new Date(),
      ...slot,
    })
    .execute();
  return id;
}
async function recordObservation(
  db: Database,
  pass: Pass,
  { span, resolved, model, outcome }: PreparedRecommendation,
  evidence: {
    matched: ShelfMatch;
    candidate: Candidate | null;
    artifactId: string;
    answerText: string;
    citations: { id: string; url: string }[];
  },
) {
  const { matched, candidate, artifactId, answerText, citations } = evidence;
  // Price and seller come from the answer's own text; a resolver-supplied
  // merchant link counts only when the answer carries it.
  const price = observedPrice(span.text, pass.locale);
  const merchantUrl = resolved?.merchant_url.trim() ?? '';
  const merchant = observedMerchant(
    span.text,
    merchantUrl && answerText.includes(merchantUrl) ? merchantUrl : undefined,
  );
  const id = await insertObservation(db, pass, artifactId, {
    ...holderFields(matched, candidate, {
      title: resolved?.title ?? span.text,
      brand: resolved?.brand ?? '',
    }),
    observed_title: resolved?.title ?? boundedText(span.text, 512),
    observed_price: price.price === null ? null : String(price.price),
    observed_currency: price.currency,
    merchant_url: merchant.url,
    merchant_domain: merchant.domain,
    model_version: model,
    resolver_outcome: outcome,
    // The resolver's prompt template, recorded whenever its model was called.
    resolver_template_version: model ? pass.versions.resolver : null,
    rank: span.rank,
    order_observable: span.orderObservable,
    surface_kind: resolved?.surface_kind ?? 'recommendation',
  });
  const linked = citations.filter((citation) => citation.url && span.text.includes(citation.url));
  if (linked.length)
    await db
      .insertInto('commerce_observation_citations')
      .values(
        linked.map((citation) => ({
          id: randomUUID(),
          workspace_id: pass.workspaceId,
          observation_id: id,
          citation_id: citation.id,
        })),
      )
      .execute();
}

type CardHolder = { matched: ShelfMatch; candidate: Candidate | null };
/**
 * The holder an earlier card with the same ChatGPT product key was matched
 * to, when that holder is on this pass's shelf: a catalog product or approved
 * competitor, or this target's AI-observed candidate. Only matches recorded
 * before the answer was captured count, so re-deriving an older answer never
 * inherits a match a later audit made.
 */
async function rememberedHolder(
  db: Database,
  { workspaceId, projectId, target, catalog }: PassContext,
  externalProductId: string,
  capturedAt: Date,
): Promise<CardHolder | null> {
  const earlier = await db
    .selectFrom('commerce_recommendation_observations')
    .select(['product_id', 'competitor_candidate_id'])
    .where('workspace_id', '=', workspaceId)
    .where('project_id', '=', projectId)
    .where('observed_external_product_id', '=', externalProductId)
    .where('created_at', '<', capturedAt)
    .where((eb) =>
      eb.or([eb('product_id', 'is not', null), eb('competitor_candidate_id', 'is not', null)]),
    )
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  if (!earlier) return null;
  const product = catalog.products.find((row) => row.id === earlier.product_id);
  if (product) return { matched: { product, competitor: null, confidence: 1 }, candidate: null };
  const competitor = catalog.approved_competitors.find(
    (row) => row.id === earlier.competitor_candidate_id,
  );
  if (competitor) return { matched: { product: null, competitor, confidence: 1 }, candidate: null };
  if (!earlier.competitor_candidate_id || !target) return null;
  const candidate = await db
    .selectFrom('commerce_competitor_candidates')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('project_id', '=', projectId)
    .where('target_kind', '=', target.target_kind)
    .where('target_id', '=', target.target_id)
    .where('id', '=', earlier.competitor_candidate_id)
    .executeTakeFirst();
  return candidate ? { matched: NO_MATCH, candidate } : null;
}
/**
 * Card matching order: the card's URL, then its ChatGPT product key as an
 * earlier card was matched, then the shelf's name rules over the title. An
 * unmatched card linking a page off the business's hosts may create an
 * AI-observed competitor of the answer's target; the card itself is that evidence.
 */
async function cardHolder(
  db: Database,
  ctx: PassContext,
  card: ShoppingResult,
  capturedAt: Date,
): Promise<CardHolder> {
  const byUrl = card.url ? matchPageUrl(card.url, ctx.catalog) : NO_MATCH;
  if (byUrl.product || byUrl.competitor) return { matched: byUrl, candidate: null };
  const remembered = card.external_product_id
    ? await rememberedHolder(db, ctx, card.external_product_id, capturedAt)
    : null;
  if (remembered) return remembered;
  const byName = matchRecommendation(card.title, ctx.catalog);
  if (byName.product || byName.competitor) return { matched: byName, candidate: null };
  const url = card.url && ctx.target ? competitorPageUrl(card.url, ctx.owned) : null;
  if (!url || !ctx.target) return { matched: NO_MATCH, candidate: null };
  const candidate = await findOrCreateCandidate(
    db,
    ctx,
    ctx.target,
    {
      title: card.title,
      brand: '',
      evidence: {
        surface_kind: 'shopping_result',
        observation_text: boundedText(card.title, shelfPolicy.span_chars),
        card_product_url: card.url,
        merchant_name: card.merchant_name,
        external_product_id: card.external_product_id,
      },
    },
    url,
  );
  return { matched: NO_MATCH, candidate };
}
/** numeric(14,2) holds prices below 10^12; anything larger is not a price. */
const cardPrice = (price: number | null) =>
  price !== null && price < 1e12 ? price.toFixed(2) : null;
/** One ranked `shopping_result` slot per organic carousel card; never sent to the resolver. */
async function recordCard(db: Database, pass: Pass, card: ShoppingResult, answer: StoredAnswer) {
  const { matched, candidate } = await cardHolder(db, pass, card, answer.capturedAt);
  const bounded = (value: string | null) => (value === null ? null : boundedText(value, 255));
  await insertObservation(db, pass, answer.artifactId, {
    ...holderFields(matched, candidate, { title: card.title, brand: '' }),
    observed_title: boundedText(card.title, 512),
    observed_price: cardPrice(card.price),
    observed_currency: card.currency,
    merchant_url: card.url,
    merchant_domain: boundedText(card.domain, 512),
    observed_tag: bounded(card.tag),
    observed_merchant_name: bounded(card.merchant_name),
    observed_external_product_id: bounded(card.external_product_id),
    observed_image_url: card.image_url,
    model_version: '',
    resolver_outcome: 'not_needed',
    resolver_template_version: null,
    rank: card.position,
    order_observable: true,
    surface_kind: 'shopping_result',
  });
}

/**
 * Record one pass over a stored answer: the pass row, then its observations.
 * The pass is unique on answer, revision and versions, so a repeated
 * derivation records nothing and returns false.
 */
export async function recordPass(
  trx: Database,
  ctx: PassContext,
  answer: StoredAnswer,
  prepared: PreparedRecommendation[],
): Promise<boolean> {
  const inserted = await trx
    .insertInto('commerce_match_passes')
    .values({
      id: randomUUID(),
      workspace_id: ctx.workspaceId,
      project_id: ctx.projectId,
      audit_id: ctx.auditId,
      task_id: ctx.taskId,
      artifact_id: answer.artifactId,
      catalog_revision_id: ctx.revisionId,
      target_kind: ctx.target?.target_kind ?? null,
      target_id: ctx.target?.target_id ?? null,
      parser_version: ctx.versions.parser,
      matcher_version: ctx.versions.matcher,
      mode: ctx.mode,
      created_at: new Date(),
    })
    .onConflict((conflict) =>
      ctx.revisionId === null
        ? conflict
            .columns(['artifact_id', 'parser_version', 'matcher_version'])
            .where('catalog_revision_id', 'is', null)
            .doNothing()
        : conflict
            .columns(['artifact_id', 'catalog_revision_id', 'parser_version', 'matcher_version'])
            .where('catalog_revision_id', 'is not', null)
            .doNothing(),
    )
    .returning('id')
    .executeTakeFirst();
  if (!inserted) return false;
  const pass: Pass = { ...ctx, passId: inserted.id };
  const citations = await trx
    .selectFrom('citations')
    .select(['id', 'url'])
    .where('workspace_id', '=', ctx.workspaceId)
    .where('audit_id', '=', ctx.auditId)
    .where('artifact_id', '=', answer.artifactId)
    .execute();
  const sourceUrls = Array.isArray(answer.citations)
    ? answer.citations
        .map((value) => record(value).url)
        .filter((value): value is string => typeof value === 'string')
    : [];
  for (const item of prepared) {
    const { span, resolved } = item;
    const identity = resolved
      ? `${resolved.title} ${resolved.brand} ${resolved.product_url}`
      : span.text;
    const matched = matchRecommendation(identity, ctx.catalog);
    const candidate =
      await /* NOSONAR -- One transaction: statements run in order. */ observedCandidate(
        trx,
        ctx,
        item,
        matched,
        { answerText: answer.answerText, sourceUrls },
      );
    // An untargeted answer keeps only the spans that name a holder.
    if (!ctx.target && !matched.product && !matched.competitor) continue;
    await /* NOSONAR -- One transaction: statements run in order. */ recordObservation(
      trx,
      pass,
      item,
      {
        matched,
        candidate,
        artifactId: answer.artifactId,
        answerText: answer.answerText,
        citations,
      },
    );
  }
  // ChatGPT carousel cards come from the stored provider response, beside the text spans.
  const cards = parseShoppingResults(record(answer.providerMetadata).raw_response);
  for (const card of cards)
    await /* NOSONAR -- One transaction: statements run in order. */ recordCard(
      trx,
      pass,
      card,
      answer,
    );
  return true;
}

const targetRefSchema = z.object({
  target_kind: z.enum(['product', 'category']),
  target_id: z.uuid(),
});
/** The buyer-prompt target an audit froze for one execution's prompt, if any. */
export async function promptTarget(
  db: Database,
  audit: Selectable<Audits>,
  promptSnapshotId: string,
): Promise<ShelfTargetRef | null> {
  if (audit.audit_scope !== 'commerce') return null;
  const ids = frozenShelfIds(record(record(audit.configuration).commerce_measurement));
  if (!ids.length) return null;
  const target = await db
    .selectFrom('commerce_prompt_targets as c')
    .innerJoin('audit_prompt_snapshots as s', 's.prompt_id', 'c.prompt_id')
    .select(['c.target_kind', 'c.target_id'])
    .where('c.workspace_id', '=', audit.workspace_id)
    .where('c.project_id', '=', audit.project_id)
    .where('c.id', 'in', ids)
    .where('s.audit_id', '=', audit.id)
    .where('s.id', '=', promptSnapshotId)
    .executeTakeFirst();
  const parsed = targetRefSchema.safeParse(target);
  return parsed.success ? parsed.data : null;
}
/** The answer's locale, for currency markers such as `$`. */
export function auditLocale(audit: Selectable<Audits>) {
  const config = record(audit.configuration);
  return [config.language_code, config.country_code]
    .filter((value) => typeof value === 'string' && value)
    .join('-');
}
const frozenString = (frozen: Record<string, unknown>, key: string, fallback: string) => {
  const value = frozen[key];
  return typeof value === 'string' ? value : fallback;
};
/** The parser, matcher and resolver versions an audit froze; the policy's for keys it lacks. */
export function frozenVersions(frozen: Record<string, unknown>): Versions {
  const current = auditPolicy.commerce_versions;
  return {
    parser: frozenString(frozen, 'parser_version', current.parser_version),
    matcher: frozenString(frozen, 'matcher_version', current.matcher_version),
    resolver: frozenString(frozen, 'resolver_template_version', current.resolver_template_version),
  };
}

/**
 * The live pass context of one execution. A buyer prompt's answer is matched
 * against the target evidence the audit froze; any other answer of a project
 * with a frozen catalog revision against that whole revision. Null when the
 * answer has nothing to match.
 */
async function liveContext(
  db: Database,
  task: AuditTask,
  audit: Selectable<Audits>,
): Promise<PassContext | null> {
  const config = record(audit.configuration);
  const scope = { workspaceId: task.workspace_id, projectId: audit.project_id };
  const revisionId = frozenRevisionId(config);
  const base = {
    workspaceId: task.workspace_id,
    projectId: audit.project_id,
    auditId: audit.id,
    taskId: task.id,
    revisionId,
    mode: 'live' as const,
    locale: auditLocale(audit),
  };
  const target = await promptTarget(db, audit, task.prompt_snapshot_id);
  if (target) {
    const frozen = record(config.commerce_measurement);
    const values = Array.isArray(frozen.targets) ? frozen.targets : [];
    const parsed = frozenTargetSchema.safeParse(
      values.find((value) => {
        const row = record(value);
        return row.kind === target.target_kind && row.id === target.target_id;
      }),
    );
    if (!parsed.success) return null;
    return {
      ...base,
      target,
      catalog: parsed.data,
      versions: frozenVersions(frozen),
      owned: await ownedHosts(db, scope),
    };
  }
  if (!revisionId) return null;
  const revision = await loadRevision(db, scope, revisionId);
  if (!revision) return null;
  return {
    ...base,
    target: null,
    catalog: revision.identity,
    versions: frozenVersions(record(config.commerce_catalog)),
    owned: await ownedHosts(db, scope),
  };
}

/** Read frozen context, then finish optional model I/O before the caller opens its persistence transaction. */
export async function prepareShelfExecution(
  db: Database,
  task: AuditTask,
  result: Pick<ExecutionResult, 'answer_text'>,
  resolver: MeterableShelfResolver | null | undefined = undefined,
): Promise<DeriveExecution> {
  const audit = await db
    .selectFrom('audits')
    .selectAll()
    .where('workspace_id', '=', task.workspace_id)
    .where('id', '=', task.audit_id)
    .executeTakeFirstOrThrow();
  const ctx = await liveContext(db, task, audit);
  if (!ctx) return deriveExecution;
  // Only a buyer prompt's answer calls the resolver: an untargeted pass keeps
  // only holder matches and creates no AI-observed competitor, so a model call
  // could add nothing the deterministic matcher misses.
  const modelResolver = (): ShelfResolver | undefined => {
    if (!ctx.target) return undefined;
    return metered(
      db,
      task.workspace_id,
      resolver === undefined ? configuredShelfResolver() : resolver,
    );
  };
  const prepared = await prepareRecommendations(result.answer_text, ctx.catalog, modelResolver());
  return async (trx, current, lockedAudit, artifactId) => {
    await deriveExecution(trx, current, lockedAudit, artifactId);
    if (
      current.id !== task.id ||
      lockedAudit.id !== audit.id ||
      current.workspace_id !== task.workspace_id
    )
      throw new Error('Commerce execution scope mismatch');
    const existing = await trx
      .selectFrom('commerce_match_passes')
      .select('artifact_id')
      .where('workspace_id', '=', task.workspace_id)
      .where('audit_id', '=', audit.id)
      .where('task_id', '=', task.id)
      .where('catalog_revision_id', ctx.revisionId === null ? 'is' : '=', ctx.revisionId)
      .where('parser_version', '=', ctx.versions.parser)
      .where('matcher_version', '=', ctx.versions.matcher)
      .executeTakeFirst();
    if (existing) {
      if (existing.artifact_id !== artifactId) throw new Error('Commerce artifact mismatch');
      return;
    }
    const artifact = await trx
      .selectFrom('raw_response_artifacts')
      .select(['answer_text', 'citations', 'provider_metadata', 'created_at'])
      .where('id', '=', artifactId)
      .where('audit_id', '=', audit.id)
      .where('task_id', '=', task.id)
      .executeTakeFirstOrThrow();
    if (artifact.answer_text !== result.answer_text)
      throw new Error('Prepared Commerce evidence mismatch');
    await recordPass(
      trx,
      ctx,
      {
        artifactId,
        answerText: artifact.answer_text,
        providerMetadata: artifact.provider_metadata,
        citations: artifact.citations,
        capturedAt: artifact.created_at,
      },
      prepared,
    );
  };
}
