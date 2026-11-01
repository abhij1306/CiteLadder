import { createHash, randomUUID } from 'node:crypto';

import { promptGenerateResponseSchema } from '@citeladder/contracts/project';
import { sql } from 'kysely';
import type { z } from 'zod';

import { agentCallLimit, dailyWorkspaceLimit, enforceWorkspaceRequest } from '../abuse/usage.ts';
import { policy, resolveSettingSpec } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record, strings } from '../db/json.ts';
import { ApiError } from '../errors.ts';
import { createModelGateway, type ModelGateway } from '../models/gateway.ts';
import { ModelError } from '../models/http.ts';
import { createJevClient, type JevClient } from '../models/jev.ts';
import {
  generationContext,
  offeringMaps,
  recoverTopics,
  type GenerationContext,
  type OfferingMap,
  type TopicRecovery,
} from './generation-context.ts';
import {
  countDrop,
  draftCallLimit,
  generateDrafts,
  type Draft,
  type Drops,
} from './generation-drafts.ts';
import {
  cohortShares,
  generationInput,
  generationInvalid,
  generationSetting,
  requestKey,
  validateRequest,
  validateSelection,
  wantedTopics,
  type GenerationInput,
} from './generation-input.ts';
import { frozenEntityMatching } from '../analysis/entity-matching.ts';
import { distribution, nearDuplicate, promptTokens } from './generation-metrics.ts';
import { dimensions, geoTerms } from './generation-plan.ts';
import { cohortQuotas, gatedOut, judgeDrafts, selectRun } from './generation-quality.ts';
import { acquireProjectLock, acquirePromptSetLock } from './locks.ts';
import { observedRef } from './observed-queries.ts';
import { scopedPromptSet } from './prompt-sets.ts';
import { meterFor, type Meter } from '../models/metering.ts';
import { listTopics } from './topics.ts';
import { candidateView, type CandidateRow } from './views.ts';

type Dependencies = {
  gateway: () => ModelGateway;
  judge: () => JevClient | null;
  /** Generation records its own and the judge's provider calls. */
  meter?: (db: Database, workspaceId: string) => Meter;
  /** Drafting stops starting batches, and cuts in-flight ones, when this aborts. */
  deadline?: () => AbortSignal;
};
const defaults: Dependencies = { gateway: createModelGateway, judge: createJevClient };
const draftDeadline = () =>
  AbortSignal.timeout(generationSetting('generation_deadline_seconds') * 1000);
type Staging = {
  workspaceId: string;
  setId: string;
  runId: string;
  now: Date;
};

/** Gate-rejected drafts keep a text-free outcome row for calibration. */
function candidateRow(draft: Draft, { workspaceId, setId, runId, now }: Staging) {
  const gated = gatedOut(draft);
  const retentionHours = gated
    ? generationSetting('rejected_outcome_retention_days') * 24
    : generationSetting('candidate_retention_hours');
  return {
    id: randomUUID(),
    workspace_id: workspaceId,
    run_id: runId,
    prompt_set_id: setId,
    topic_id: draft.slot.topic_id,
    text: gated ? '' : draft.text,
    normalized_text_hash: gated ? '' : draft.hash,
    intent: draft.intent,
    buyer_stage: draft.buyer_stage,
    prompt_intent: draft.prompt_intent,
    cohort: draft.slot.cohort,
    slot_id: draft.slot.slot_id,
    evidence_refs: JSON.stringify([
      draft.slot.evidence_ref,
      ...(draft.slot.grounding ?? []).map(observedRef),
    ]),
    validation: JSON.stringify({
      admission: 'passed',
      topical_binding: policy.prompts.binding.accepted,
    }),
    jev_decision: draft.decision ? JSON.stringify(draft.decision) : null,
    disposition: gated ? 'gate_rejected' : 'pending',
    prompt_id: null,
    created_at: now,
    reviewed_at: gated ? now : null,
    expires_at: new Date(now.getTime() + retentionHours * 3_600_000),
  };
}

function stampRun(suggestion: OfferingMap, runId: string) {
  for (const entry of dimensions.flatMap((dimension) => suggestion[dimension]))
    entry.source = { ...entry.source, generation_run_id: runId };
}

/** Store suggested maps only for still-confirmed offerings that have no facets yet. */
async function mergeMapSuggestions(
  trx: Database,
  { workspaceId, runId, now }: Staging,
  projectId: string,
  suggestions: OfferingMap[],
) {
  if (!suggestions.length) return;
  const profile = await trx
    .selectFrom('brand_profiles')
    .selectAll()
    .where('project_id', '=', projectId)
    .where('workspace_id', '=', workspaceId)
    .forUpdate()
    .executeTakeFirst();
  if (!profile) return;
  const business = record(profile.business_context);
  const existing = offeringMaps(business);
  const offerings = new Set(strings(profile.products_services).map((name) => name.toLowerCase()));
  for (const suggestion of suggestions) {
    const offering = suggestion.offering.toLowerCase();
    if (!offerings.has(offering)) continue;
    const index = existing.findIndex((map) => map.offering.toLowerCase() === offering);
    const prior = existing[index];
    if (prior && dimensions.some((dimension) => prior[dimension].length)) continue;
    stampRun(suggestion, runId);
    if (index < 0) existing.push(suggestion);
    else existing[index] = suggestion;
  }
  await trx
    .updateTable('brand_profiles')
    .set({
      business_context: JSON.stringify({ ...business, business_map: { offerings: existing } }),
      updated_at: now,
    })
    .where('id', '=', profile.id)
    .execute();
}

type StageInput = {
  workspaceId: string;
  context: GenerationContext;
  input: GenerationInput;
  idempotencyKey: string | null;
  output: Awaited<ReturnType<typeof generateDrafts>>;
  gate: Awaited<ReturnType<typeof judgeDrafts>>;
  recovery: TopicRecovery;
};

function stage(
  db: Database,
  { workspaceId, context, input, idempotencyKey, output, gate, recovery }: StageInput,
) {
  return db.transaction().execute(async (trx) => {
    await acquireProjectLock(trx, context.project.id);
    await acquirePromptSetLock(trx, context.set.id);
    const set = await scopedPromptSet(trx, workspaceId, context.set.id);
    // A concurrent repeat of the same key stages once; the loser replays it.
    const prior = idempotencyKey
      ? await replay(trx, workspaceId, set.id, input, idempotencyKey)
      : null;
    if (prior) return prior;
    const topics = await trx
      .selectFrom('topics')
      .select('id')
      .where('project_id', '=', set.project_id)
      .execute();
    validateSelection(input, topics);
    const now = new Date(),
      runId = randomUUID();
    await trx
      .deleteFrom('prompt_candidates')
      .where('workspace_id', '=', workspaceId)
      .where('prompt_set_id', '=', set.id)
      .where('disposition', 'in', [
        policy.prompts.candidate.pending,
        ...policy.prompts.candidate.outcomes,
      ])
      .where('expires_at', '<=', now)
      .execute();
    const tracked = await trx
      .selectFrom('prompts')
      .select(['text', 'normalized_text_hash'])
      .where('prompt_set_id', '=', set.id)
      .execute();
    const pending = await trx
      .selectFrom('prompt_candidates')
      .select(['text', 'normalized_text_hash'])
      .where('workspace_id', '=', workspaceId)
      .where('prompt_set_id', '=', set.id)
      .where('disposition', '=', 'pending')
      .execute();
    const known = new Set([...tracked, ...pending].map((row) => row.normalized_text_hash));
    // Live texts drafted since the context read: admission saw the rest.
    const read = new Set([
      ...context.prompts.map((row) => row.normalized_text_hash),
      ...context.candidates.map((row) => row.normalized_text_hash),
    ]);
    const live = [...tracked, ...pending]
      .filter((row) => !read.has(row.normalized_text_hash))
      .map((row) => promptTokens(row.text));
    const drops: Drops = { ...output.drops };
    const dropRecords = [...output.dropRecords];
    const eligible = output.drafts.filter((row, row_index) => {
      let reason: 'duplicate' | 'unknown_topic' | 'near_duplicate' | null = null;
      const tokens = promptTokens(row.text);
      if (known.has(row.hash)) reason = 'duplicate';
      else if (!topics.some((topic) => topic.id === row.slot.topic_id)) reason = 'unknown_topic';
      else if (live.some((other) => nearDuplicate(tokens, other))) reason = 'near_duplicate';
      if (!reason) return true;
      countDrop(drops, reason);
      dropRecords.push({
        reason,
        slot_id: row.slot.slot_id,
        normalized_text_hash: row.hash,
        phase: 'staging',
        batch: 0,
        row_index,
      });
      return false;
    });
    const selected = selectRun(eligible, input),
      rejected = eligible.filter(gatedOut),
      geo = geoTerms(context);
    const revision = context.revision;
    const evidence = {
      generator_version: policy.prompts.generation.version,
      buyer_query_policy_version: policy.prompts.generation.policy_version,
      generation_mode: revision ? 'agent_proposal' : 'quick',
      requested_count: input.count,
      requested_topic_ids: wantedTopics(input),
      cohort: input.cohort,
      // The run's own steering, frozen as requested, and the quotas it set.
      run_context: input.run_context || null,
      requested_distribution: input.distribution ?? null,
      cohort_quotas: cohortQuotas(input),
      seed_source: input.seed_source ?? null,
      seed_query_ids: input.seed_query_ids,
      topic_recovery: recovery,
      business_map_suggested_offerings: output.maps.map((map) => map.offering),
      model_results: output.models,
      quality_gate: gate,
      candidates_generated: output.drafts.length,
      admission_drops: drops,
      admission_drop_records: dropRecords,
      stop_reason: output.stop,
      entity_matching: frozenEntityMatching(context.matching),
      distribution: {
        admitted: distribution(output.drafts, geo),
        selected: distribution(selected, geo),
      },
      // What drafting worked from: the narrow brief for quick generation,
      // the business context for an Agent portfolio.
      brand_context_hash: createHash('sha256')
        .update(JSON.stringify(output.reference))
        .digest('hex'),
      source_artifact_ids: context.context.knowledge_base.source_artifact_ids,
      demand_snapshot_id: context.snapshot?.id ?? null,
      demand_signal_ids: context.demand.map((row) => row.id),
      demand_signal_coverage: context.snapshot?.coverage ?? {},
      grounding: output.grounding,
      ...(revision
        ? {
            agent_output_id: revision.output_id,
            agent_revision_id: revision.id,
            agent_run_id: revision.run_id,
            source_refs: revision.source_refs,
          }
        : {}),
    };
    await trx
      .insertInto('prompt_generation_runs')
      .values({
        id: runId,
        workspace_id: workspaceId,
        project_id: set.project_id,
        prompt_set_id: set.id,
        generator_version: policy.prompts.generation.version,
        request: JSON.stringify({
          ...input,
          ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
        }),
        provenance: JSON.stringify(evidence),
        created_at: now,
      })
      .execute();
    const staging = { workspaceId, setId: set.id, runId, now };
    const rows = [...selected, ...rejected].map((draft) => candidateRow(draft, staging));
    const inserted = rows.length
      ? await trx.insertInto('prompt_candidates').values(rows).returningAll().execute()
      : [];
    await mergeMapSuggestions(trx, staging, set.project_id, output.maps);
    return runResponse(trx, workspaceId, set.project_id, inserted, {
      gate,
      drops,
      generated: output.drafts.length,
      requested: input.count,
      stop: output.stop,
    });
  });
}

/**
 * A run's response from its staged rows (pending and gate-rejected): the same
 * shape whether the run was just staged or replayed for a repeated key.
 */
async function runResponse(
  db: Database,
  workspaceId: string,
  projectId: string,
  rows: CandidateRow[],
  run: {
    gate: z.infer<typeof recorded.quality_gate>;
    drops: Drops;
    generated: number;
    requested: number;
    stop: z.infer<typeof recorded.shortfall_reason>;
  },
) {
  const candidates = rows.filter((row) => row.disposition === 'pending');
  const touched = new Set(candidates.map((row) => row.topic_id));
  return {
    candidates: candidates.map((row) => candidateView(row, run.gate)),
    topics: (await listTopics(db, workspaceId, projectId)).filter((topic) => touched.has(topic.id)),
    requested_count: run.requested,
    dropped_duplicates: run.drops.duplicate ?? 0,
    candidates_generated: run.generated,
    quality_gate: run.gate,
    quality_rejected: rows.length - candidates.length,
    admission_drops: run.drops,
    shortfall_reason: candidates.length < run.requested ? run.stop : null,
  };
}

/** Persisted run fields read back with the response contract's own schemas. */
const recorded = promptGenerateResponseSchema.shape;
/** Every input that changes a run, including its distribution, note and seeds. */
const sameRequest = (a: GenerationInput, b: GenerationInput) => requestKey(a) === requestKey(b);

/**
 * The response of an earlier run with this key, from persisted rows only: its
 * still-pending candidates and recorded counts. A key reused for a different
 * request is a conflict; a run past candidate retention is not replayed.
 */
async function replay(
  db: Database,
  workspaceId: string,
  setId: string,
  input: GenerationInput,
  key: string,
) {
  const retention = generationSetting('candidate_retention_hours') * 3_600_000;
  const run = await db
    .selectFrom('prompt_generation_runs')
    .select(['id', 'project_id', 'request', 'provenance'])
    .where('workspace_id', '=', workspaceId)
    .where('prompt_set_id', '=', setId)
    .where(sql<string>`request->>'idempotency_key'`, '=', key)
    .where('created_at', '>', new Date(Date.now() - retention))
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
  if (!run) return null;
  const stored = generationInput.safeParse(run.request);
  if (!stored.success || !sameRequest(stored.data, input))
    throw new ApiError(409, 'Idempotency-Key was used for another generation request', {
      code: 'generation_idempotency_conflict',
    });
  const provenance = record(run.provenance);
  const rows = await db
    .selectFrom('prompt_candidates')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('run_id', '=', run.id)
    .where('disposition', 'in', ['pending', 'gate_rejected'])
    .where('expires_at', '>', new Date())
    .execute();
  return runResponse(db, workspaceId, run.project_id, rows, {
    gate: recorded.quality_gate.catch('off').parse(provenance.quality_gate),
    drops: recorded.admission_drops.catch({}).parse(provenance.admission_drops),
    generated: Number(provenance.candidates_generated) || 0,
    requested: input.count,
    stop: recorded.shortfall_reason.catch(null).parse(provenance.stop_reason),
  });
}

async function requireCompetitor(db: Database, workspaceId: string, setId: string) {
  const set = await scopedPromptSet(db, workspaceId, setId);
  const competitor = await db
    .selectFrom('competitors')
    .select('id')
    .where('project_id', '=', set.project_id)
    .executeTakeFirst();
  if (!competitor) throw generationInvalid('Add a competitor before generating comparison prompts');
}

export async function generatePrompts(
  db: Database,
  workspaceId: string,
  setId: string,
  input: GenerationInput,
  dependencies: Dependencies = defaults,
  idempotencyKey: string | null = null,
) {
  if (idempotencyKey) {
    // Authorize the set before revealing whether the key was used.
    await scopedPromptSet(db, workspaceId, setId);
    const prior = await replay(db, workspaceId, setId, input, idempotencyKey);
    if (prior) return prior;
  }
  // Request-shape checks need no topics; ownership of named topics is checked
  // with the project's topics in the context read, before any model call.
  validateRequest(input);
  // A comparison share needs a competitor; refuse before topic recovery can
  // spend a model call or write topics for a request that would fail anyway.
  if (cohortShares(input).comparison > 0) await requireCompetitor(db, workspaceId, setId);
  const meter = (dependencies.meter ?? meterFor)(db, workspaceId);
  // Configured only once the set is authorized: an Agent portfolio drafts nothing.
  let metered: ModelGateway | undefined;
  const gatewayFor = () => {
    if (input.agent_revision_id) return null;
    metered ??= meter.gateway(dependencies.gateway(), 'prompt_generation');
    return metered;
  };
  const deadline = (dependencies.deadline ?? draftDeadline)();
  try {
    // Only a quick run over every topic proposes topics for a project that
    // has none: an Agent portfolio files rows under existing topics, and a
    // request naming topics needs them to exist already.
    const recovery =
      input.agent_revision_id || wantedTopics(input).length
        ? null
        : await recoverTopics(
            db,
            { workspaceId, setId },
            {
              gateway: gatewayFor,
              deadline,
              reserve: () =>
                enforceWorkspaceRequest(
                  db,
                  workspaceId,
                  agentCallLimit(policy.prompts.generation.topic_calls),
                ),
            },
          );
    const context = await generationContext(db, workspaceId, setId, input);
    if (cohortShares(input).comparison > 0 && !context.context.competitors.length)
      throw generationInvalid('Add a competitor before generating comparison prompts');
    const gateway = gatewayFor();
    if (gateway)
      await enforceWorkspaceRequest(
        db,
        workspaceId,
        agentCallLimit(draftCallLimit(input) + policy.prompts.generation.map_calls),
      );
    const output = await generateDrafts(context, input, gateway, deadline);
    const judge = dependencies.judge();
    // Judge calls are platform-paid on both the drafting and the revision
    // path, so each generation spends its bounded call count before judging.
    if (judge && output.drafts.length)
      await enforceWorkspaceRequest(
        db,
        workspaceId,
        dailyWorkspaceLimit(
          'prompt_generation.judge',
          'prompt_judge_calls_per_workspace_daily',
          Math.min(
            output.drafts.length,
            Number(resolveSettingSpec(policy.models.jev.max_calls_per_generation)),
          ),
        ),
      );
    const gate = await judgeDrafts(
      context,
      output.drafts,
      judge ? meter.jev(judge, 'prompt_quality_judge') : null,
    );
    return await stage(db, {
      workspaceId,
      context,
      input,
      idempotencyKey,
      output,
      gate,
      recovery,
    });
  } catch (error) {
    throw error instanceof ModelError ? generationFailure(error) : error;
  }
}

/** The customer-facing error for a provider failure; operator detail stays in logs. */
function generationFailure(error: ModelError) {
  if (error.code === 'not_configured')
    return new ApiError(503, "Prompt generation isn't available on this deployment yet", {
      code: 'agent_not_configured',
    });
  if (error.status === 429)
    return new ApiError(429, 'Model provider is rate limited', {
      code: 'rate_limited',
      headers: error.retryAfter ? { 'retry-after': error.retryAfter } : undefined,
    });
  return new ApiError(502, 'Model generation failed', {
    code: error.code === 'parse' ? 'generation_unparseable' : 'agent_call_failed',
  });
}
