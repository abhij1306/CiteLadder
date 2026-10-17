import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Selectable } from 'kysely';
import type { Database } from '../db/database.ts';
import type { Audits } from '../generated/db-schema.ts';
import { record, strings } from '../db/json.ts';
import type { AuditTask } from '../queue/audit-queue.ts';
import type { DeriveExecution, ExecutionResult } from '../audits/result-persistence.ts';
import { analyzeExecution } from '../analysis/execution.ts';
import { auditPolicy } from '../audits/config.ts';
import { createModelGateway, gatewaySettings } from '../models/gateway.ts';
import { agentCallLimit, enforceWorkspaceRequest } from '../abuse/usage.ts';
import { meterFor, type Meter } from '../models/metering.ts';
import { lockCatalog } from './catalog-store.ts';
import { ownedHosts } from './discovery-validation.ts';
import {
  boundedText,
  frozenTargetSchema,
  matchRecommendation,
  observedMerchant,
  observedPrice,
  prepareRecommendations,
  resolvedBatchSchema,
  resolvedCompetitorUrl,
  shelfPolicy,
  type FrozenShelfTarget,
  type ShelfResolver,
} from './shelf-parsing.ts';

export function frozenShelfIds(frozen: Record<string, unknown>) {
  return strings(frozen.prompt_target_ids).filter((id) => z.uuid().safeParse(id).success);
}
/** A resolver that runs its model call under the answer's workspace meter. */
export type MeterableShelfResolver = {
  model: string;
  resolve(spans: string[], meter: Meter): Promise<unknown>;
};
export function configuredShelfResolver(
  env: Record<string, string | undefined> = process.env,
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
      await enforceWorkspaceRequest(db, workspaceId, agentCallLimit(1));
      return resolver.resolve(spans, meterFor(db, workspaceId));
    },
  };
}

type PreparedItem = Awaited<ReturnType<typeof prepareRecommendations>>[number];
type ShelfMatch = ReturnType<typeof matchRecommendation>;
type ShelfContext = {
  task: AuditTask;
  audit: Selectable<Audits>;
  target: { target_kind: string; target_id: string };
  catalog: FrozenShelfTarget;
  versions: { parser: string; matcher: string };
  owned: string[];
  locale: string;
};

async function findOrCreateCandidate(
  db: Database,
  { task, audit, target }: ShelfContext,
  resolved: NonNullable<PreparedItem['resolved']>,
  spanText: string,
  url: string,
) {
  const find = () =>
    db
      .selectFrom('commerce_competitor_candidates')
      .selectAll()
      .where('workspace_id', '=', task.workspace_id)
      .where('project_id', '=', audit.project_id)
      .where('target_kind', '=', target.target_kind)
      .where('target_id', '=', target.target_id)
      .where('canonical_url', '=', url)
      .executeTakeFirst();
  const existing = await find();
  if (existing) return existing;
  // Concurrent audit completions serialize new pending candidates on the owning project.
  await lockCatalog(db, { workspaceId: task.workspace_id, projectId: audit.project_id });
  const raced = await find();
  if (raced) return raced;
  return db
    .insertInto('commerce_competitor_candidates')
    .values({
      id: randomUUID(),
      workspace_id: task.workspace_id,
      project_id: audit.project_id,
      target_kind: target.target_kind,
      target_id: target.target_id,
      canonical_url: url,
      product_name: resolved.title,
      brand_name: resolved.brand,
      state: 'pending',
      source_kind: 'ai_observed',
      evidence: JSON.stringify({
        observation_text: boundedText(spanText, shelfPolicy.span_chars),
        resolved_product_url: url,
        merchant_url: resolved.merchant_url,
      }),
      attempt_id: null,
      decision_at: null,
      created_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}
/** A recommendation matching neither catalog product nor approved competitor may be a new AI-observed competitor. */
async function observedCandidate(
  db: Database,
  ctx: ShelfContext,
  { span, resolved }: PreparedItem,
  matched: ShelfMatch,
  evidence: { answerText: string; sourceUrls: string[] },
) {
  if (matched.product || matched.competitor || !resolved) return null;
  const url = resolvedCompetitorUrl(resolved.product_url, {
    answer: evidence.answerText,
    citations: evidence.sourceUrls,
    ownedHosts: ctx.owned,
  });
  return url ? findOrCreateCandidate(db, ctx, resolved, span.text, url) : null;
}
function observationClassification(matched: ShelfMatch, candidate: { id: string } | null) {
  if (matched.product) return 'owned';
  if (matched.competitor) return 'approved_competitor';
  return candidate ? 'ai_observed_competitor' : 'unresolved';
}
async function recordObservation(
  db: Database,
  { task, audit, target, versions, locale }: ShelfContext,
  { span, resolved, model }: PreparedItem,
  evidence: {
    matched: ShelfMatch;
    candidate: { id: string; product_name: string; brand_name: string } | null;
    artifactId: string;
    answerText: string;
    citations: { id: string; url: string }[];
  },
) {
  const { matched, candidate, artifactId, answerText, citations } = evidence;
  // Price and seller come from the answer's own text; a resolver-supplied
  // merchant link counts only when the answer carries it.
  const price = observedPrice(span.text, locale);
  const merchantUrl = resolved?.merchant_url.trim() ?? '';
  const merchant = observedMerchant(
    span.text,
    merchantUrl && answerText.includes(merchantUrl) ? merchantUrl : undefined,
  );
  const id = randomUUID();
  await db
    .insertInto('commerce_recommendation_observations')
    .values({
      id,
      workspace_id: task.workspace_id,
      project_id: audit.project_id,
      audit_id: audit.id,
      task_id: task.id,
      artifact_id: artifactId,
      target_kind: target.target_kind,
      target_id: target.target_id,
      parser_version: versions.parser,
      matcher_version: versions.matcher,
      product_id: matched.product?.id ?? null,
      competitor_candidate_id: matched.competitor?.id ?? candidate?.id ?? null,
      classification: observationClassification(matched, candidate),
      observed_product:
        matched.product?.name ??
        matched.competitor?.product_name ??
        candidate?.product_name ??
        resolved?.title ??
        boundedText(span.text, 512),
      observed_brand:
        matched.product?.brand ??
        matched.competitor?.brand_name ??
        candidate?.brand_name ??
        resolved?.brand ??
        '',
      observed_title: resolved?.title ?? boundedText(span.text, 512),
      observed_price: price.price === null ? null : String(price.price),
      observed_currency: price.currency,
      merchant_url: merchant.url,
      merchant_domain: merchant.domain,
      model_version: model,
      match_confidence: matched.confidence,
      rank: span.rank,
      order_observable: span.orderObservable,
      surface_kind: resolved?.surface_kind ?? 'recommendation',
      created_at: new Date(),
    })
    .execute();
  const linked = citations.filter((citation) => citation.url && span.text.includes(citation.url));
  if (linked.length)
    await db
      .insertInto('commerce_observation_citations')
      .values(
        linked.map((citation) => ({
          id: randomUUID(),
          observation_id: id,
          citation_id: citation.id,
        })),
      )
      .execute();
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
  if (audit.audit_scope !== 'commerce') return analyzeExecution;
  const config = record(audit.configuration),
    frozen = record(config.commerce_measurement);
  const ids = frozenShelfIds(frozen);
  if (!ids.length) return analyzeExecution;
  const target = await db
    .selectFrom('commerce_prompt_targets as c')
    .innerJoin('audit_prompt_snapshots as s', 's.prompt_id', 'c.prompt_id')
    .selectAll('c')
    .where('c.workspace_id', '=', task.workspace_id)
    .where('c.project_id', '=', audit.project_id)
    .where('c.id', 'in', ids)
    .where('s.audit_id', '=', audit.id)
    .where('s.id', '=', task.prompt_snapshot_id)
    .executeTakeFirst();
  if (!target) return analyzeExecution;
  const values = Array.isArray(frozen.targets) ? frozen.targets : [];
  const parsed = frozenTargetSchema.safeParse(
    values.find((value) => {
      const row = record(value);
      return row.kind === target.target_kind && row.id === target.target_id;
    }),
  );
  if (!parsed.success) return analyzeExecution;
  const catalog = parsed.data;
  const prepared = await prepareRecommendations(
    result.answer_text,
    catalog,
    metered(db, task.workspace_id, resolver === undefined ? configuredShelfResolver() : resolver),
  );
  const owned = await ownedHosts(db, {
    workspaceId: task.workspace_id,
    projectId: audit.project_id,
  });
  const versions = {
    parser:
      typeof frozen.parser_version === 'string'
        ? frozen.parser_version
        : auditPolicy.commerce_versions.parser_version,
    matcher:
      typeof frozen.matcher_version === 'string'
        ? frozen.matcher_version
        : auditPolicy.commerce_versions.matcher_version,
  };
  const locale = [config.language_code, config.country_code]
    .filter((value) => typeof value === 'string' && value)
    .join('-');
  const ctx: ShelfContext = { task, audit, target, catalog, versions, owned, locale };
  return async (trx, current, lockedAudit, artifactId) => {
    await analyzeExecution(trx, current, lockedAudit, artifactId);
    if (
      current.id !== task.id ||
      lockedAudit.id !== audit.id ||
      current.workspace_id !== task.workspace_id
    )
      throw new Error('Commerce execution scope mismatch');
    const existing = await trx
      .selectFrom('commerce_recommendation_observations')
      .select(['id', 'artifact_id'])
      .where('workspace_id', '=', task.workspace_id)
      .where('audit_id', '=', audit.id)
      .where('task_id', '=', task.id)
      .where('parser_version', '=', versions.parser)
      .where('matcher_version', '=', versions.matcher)
      .executeTakeFirst();
    if (existing) {
      if (existing.artifact_id !== artifactId) throw new Error('Commerce artifact mismatch');
      return;
    }
    const artifact = await trx
      .selectFrom('raw_response_artifacts')
      .select(['answer_text', 'citations'])
      .where('id', '=', artifactId)
      .where('audit_id', '=', audit.id)
      .where('task_id', '=', task.id)
      .executeTakeFirstOrThrow();
    if (artifact.answer_text !== result.answer_text)
      throw new Error('Prepared Commerce evidence mismatch');
    const citations = await trx
      .selectFrom('citations')
      .select(['id', 'url'])
      .where('workspace_id', '=', task.workspace_id)
      .where('audit_id', '=', audit.id)
      .where('artifact_id', '=', artifactId)
      .execute();
    const sourceUrls = Array.isArray(artifact.citations)
      ? artifact.citations
          .map((value) => record(value).url)
          .filter((value): value is string => typeof value === 'string')
      : [];
    for (const item of prepared) {
      const { span, resolved } = item;
      const identity = resolved
        ? `${resolved.title} ${resolved.brand} ${resolved.product_url}`
        : span.text;
      const matched = matchRecommendation(identity, catalog);
      const candidate = await observedCandidate(trx, ctx, item, matched, {
        answerText: artifact.answer_text,
        sourceUrls,
      });
      await recordObservation(trx, ctx, item, {
        matched,
        candidate,
        artifactId,
        answerText: artifact.answer_text,
        citations,
      });
    }
  };
}
