import type {
  PromptAdmissionDropReason,
  promptGenerateResponseSchema,
} from '@citeladder/contracts/project';
import { parsePromptProposal } from '@citeladder/contracts/prompt-proposal';
import { z } from 'zod';

import { namesAlias, namesEntity } from '../analysis/aliases.ts';
import { entityKey } from '../analysis/entity-matching.ts';
import { policy } from '../config.ts';
import { generationSystemPrompt } from '../config/prompt-generation.ts';
import { record, strings } from '../db/json.ts';
import { getLogger } from '../logging.ts';
import { ModelError, providerErrorCode } from '../models/http.ts';
import type { ModelGateway } from '../models/gateway.ts';
import { bindingFailure } from './binding.ts';
import type { GenerationContext, OfferingMap } from './generation-context.ts';
import { generationInvalid, generationSetting, type GenerationInput } from './generation-input.ts';
import {
  dimensions,
  generationBrief,
  geoTerms,
  modelSlot,
  namesPlace,
  planSlots,
  type Slot,
} from './generation-plan.ts';
import { promptTextHash } from './normalization.ts';
import { observedRef } from './observed-queries.ts';

const G = policy.prompts.generation;
export const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
/** An unfilled template slot such as `[city]` or `{product}`. */
export const hasPlaceholder = (text: string) => /[[{<][^[\]{}<>]*[\]}>]/u.test(text);
const containsName = (text: string, names: readonly string[]) =>
  names.some((name) => namesAlias(text, name));
const stem = (token: string) => token.replace(/(?<=[sxz]|ch|sh)es$/u, '').replace(/(?<!s)s$/u, '');

function brandTerms(context: GenerationContext): string[] {
  const { brand_name: brand, brand_aliases: aliases, business_context: business } = context.context;
  const generic = new Set([
    ...G.provider_phrases.flatMap(words).map(stem),
    ...policy.prompts.binding.stopwords,
    ...G.brand_common_words,
  ]);
  const category = new Set(
    policy.prompts.binding.business_context_fields.flatMap((field) => {
      const value = record(business)[field];
      return (typeof value === 'string' ? [value] : strings(value)).flatMap((phrase) =>
        phrase
          .replaceAll(/\s+/gu, ' ')
          .split(/ - |[(),;/–—|]+/u)
          .map((segment) => stem(words(segment).at(-1) ?? '')),
      );
    }),
  );
  return [
    brand,
    ...aliases,
    ...words(brand).filter(
      (token) => token.length >= 4 && !generic.has(stem(token)) && !category.has(stem(token)),
    ),
  ];
}

export type Draft = {
  slot: Slot;
  text: string;
  hash: string;
  intent: string;
  buyer_stage: string;
  prompt_intent: string;
  /** The model's own place label: recorded beside the deterministic check, never used to drop. */
  names_place?: boolean;
  decision?: Record<string, unknown>;
};

const generatedRow = z.object({
  slot_id: z.string(),
  text: z.string(),
  buyer_stage: z.string(),
  prompt_intent: z.string(),
  names_place: z.boolean().optional(),
});
const generated = z.object({ prompts: z.array(generatedRow) });

export type Drops = Partial<Record<PromptAdmissionDropReason, number>>;
type AdmissionDrop = {
  reason: PromptAdmissionDropReason;
  slot_id: string;
  normalized_text_hash: string;
  phase: 'admission' | 'staging';
  batch: number;
  row_index: number;
  names_place?: boolean | null;
};
export function countDrop(drops: Drops, reason: PromptAdmissionDropReason, count = 1) {
  if (count) drops[reason] = (drops[reason] ?? 0) + count;
}
function mergeDrops(into: Drops, from: Drops) {
  for (const [reason, count] of Object.entries(from))
    countDrop(into, reason as PromptAdmissionDropReason, count);
}

/**
 * Admit rows in order, recording one reason per dropped row. Planning checks
 * (slot, labels, duplicates) run before content checks, so a row is reported
 * under the first rule it breaks.
 */
export function admitDrafts(
  rows: z.infer<typeof generatedRow>[],
  slots: Slot[],
  context: GenerationContext,
  input: GenerationInput,
  prior: Draft[],
  batch = 0,
) {
  const seen = new Set([
    ...context.prompts.map((row) => row.normalized_text_hash),
    ...context.candidates
      .filter((row) => row.disposition === 'pending')
      .map((row) => row.normalized_text_hash),
    ...prior.map((row) => row.hash),
  ]);
  const usedSlots = new Set(prior.map((row) => row.slot.slot_id));
  // Every observed search the run read, not only the top demand signals: a
  // draft repeating one is a search, not a question written for an assistant.
  const observed = new Set([
    ...context.context.demand_signals.flatMap((row) =>
      typeof row.observed_query === 'string' ? [promptTextHash(row.observed_query)] : [],
    ),
    ...context.observed.map((query) => promptTextHash(query.text)),
  ]);
  const brands = brandTerms(context);
  // Agent rows are targeted on purpose; only quick-generate cells plan places.
  const quick = !context.revision;
  const geo = quick ? geoTerms(context) : [];
  // Names count under the project's matching policy, so a common-word brand
  // in ordinary language ("target audience") is not a branded draft.
  const brandRule = context.matching[entityKey(context.context.brand_name)];
  const competitors = context.context.competitors.map((row) => ({
    aliases: [row.name, ...row.aliases],
    rule: context.matching[entityKey(row.name)],
  }));
  const namesCompetitor = (text: string) =>
    competitors.some(({ aliases, rule }) => namesEntity(text, aliases, rule));
  /** Planning checks: the row answers an open slot with labels it allows. */
  const planReason = (
    row: z.infer<typeof generatedRow>,
    slot: Slot | undefined,
  ): PromptAdmissionDropReason | null => {
    if (!slot || usedSlots.has(slot.slot_id)) return 'unplanned_slot';
    if (!slot.allowed_prompt_intents.includes(row.prompt_intent)) return 'intent';
    if (!G.stages.includes(row.buyer_stage)) return 'stage';
    // A planned core row's intent must suit the stage the model labelled it
    // with; Agent rows keep the labels the user reviewed in the portfolio.
    const coherent = G.stage_intents[row.buyer_stage]?.includes(row.prompt_intent);
    return quick && input.cohort === 'core' && !coherent ? 'intent' : null;
  };
  /** Identity checks: who the row names, by cohort. */
  const cohortReason = (
    row: z.infer<typeof generatedRow>,
    text: string,
  ): PromptAdmissionDropReason | null => {
    if (input.cohort === 'core')
      return namesEntity(text, brands, brandRule) || namesCompetitor(text) ? 'branded_core' : null;
    if (!namesEntity(text, [context.context.brand_name], brandRule)) return 'brand_missing';
    const compares = namesCompetitor(text) && row.prompt_intent === 'compare';
    return input.cohort === 'comparison' && !compares ? 'competitor_missing' : null;
  };
  const reason = (
    row: z.infer<typeof generatedRow>,
    slot: Slot | undefined,
    text: string,
    hash: string,
  ): PromptAdmissionDropReason | null => {
    const planned = planReason(row, slot);
    if (planned || !slot) return planned ?? 'unplanned_slot';
    if (seen.has(hash)) return 'duplicate';
    if (
      !text ||
      text.length > policy.prompts.text_max_chars ||
      words(text).length < policy.prompts.text_min_words
    )
      return 'length';
    if (hasPlaceholder(text)) return 'placeholder';
    if (observed.has(hash)) return 'observed_copy';
    if (bindingFailure(text, context.vocabulary)) return 'off_topic';
    if (!slot.buyer_need.market && namesPlace(text, geo)) return 'location_unplanned';
    return cohortReason(row, text);
  };
  const admitted: Draft[] = [];
  const drops: Drops = {};
  const dropRecords: AdmissionDrop[] = [];
  for (const [row_index, row] of rows.entries()) {
    const slot = slots.find((item) => item.slot_id === row.slot_id);
    const text = row.text.trim().replace(/\s+/gu, ' '),
      hash = promptTextHash(text);
    const dropped = reason(row, slot, text, hash);
    if (dropped || !slot) {
      countDrop(drops, dropped ?? 'unplanned_slot');
      dropRecords.push({
        reason: dropped ?? 'unplanned_slot',
        slot_id: row.slot_id,
        normalized_text_hash: hash,
        phase: 'admission',
        batch,
        row_index,
        ...(dropped === 'location_unplanned' ? { names_place: row.names_place ?? null } : {}),
      });
      continue;
    }
    seen.add(hash);
    usedSlots.add(slot.slot_id);
    admitted.push({
      slot,
      text,
      hash,
      intent: G.intent_legacy[row.prompt_intent as keyof typeof G.intent_legacy],
      buyer_stage: row.buyer_stage,
      prompt_intent: row.prompt_intent,
      ...(row.names_place === undefined ? {} : { names_place: row.names_place }),
    });
  }
  return { admitted, drops, dropRecords };
}

async function suggestMaps(
  gateway: ModelGateway,
  context: GenerationContext,
  deadline: AbortSignal,
): Promise<OfferingMap[]> {
  const wanted = context.offerings.filter(
    (name) =>
      context.selected.some((topic) => topic.name.toLowerCase() === name.toLowerCase()) &&
      !context.maps.some(
        (map) =>
          map.offering.toLowerCase() === name.toLowerCase() &&
          dimensions.some((key) => map[key].length),
      ),
  );
  if (!wanted.length) return [];
  const values = z.array(z.string());
  const schema = z.object({
    offerings: z.array(
      z.object({ offering: z.string(), attributes: values, situations: values, audiences: values }),
    ),
  });
  try {
    const response = await gateway.structured(
      G.map_system,
      JSON.stringify({
        business_context: context.context.business_context,
        knowledge_base: context.context.knowledge_base,
        offerings: wanted,
      }),
      schema,
      deadline,
    );
    const places = geoTerms(context);
    const banned = [
      context.context.brand_name,
      ...context.context.brand_aliases,
      ...context.context.competitors.flatMap((row) => [row.name, ...row.aliases]),
    ];
    return response.value.offerings.flatMap((item) => {
      const offering = wanted.find((name) => name.toLowerCase() === item.offering.toLowerCase());
      if (!offering) return [];
      const entries = (dimension: (typeof dimensions)[number]) =>
        [
          ...new Set(
            item[dimension]
              .slice(0, G.map_max_entries)
              .map((value) =>
                value
                  .trim()
                  .replace(/\s+/gu, ' ')
                  .slice(0, policy.brand_identity.map_value_max_chars),
              ),
          ),
        ]
          .filter((value) => value && !containsName(value, banned) && !namesPlace(value, places))
          .map((value) => ({
            value,
            origin: 'model' as const,
            review_state: 'suggested' as const,
            reviewed_by: null,
            reviewed_at: null,
            source: {
              generator_version: G.version,
              model: response.result.returned_model,
              transport_host: response.result.endpoint_host,
            },
          }));
      return [
        {
          offering,
          attributes: entries('attributes'),
          situations: entries('situations'),
          audiences: entries('audiences'),
          exclusions: [],
        },
      ];
    });
  } catch (error) {
    if (!(error instanceof ModelError) && !deadline.aborted) throw error;
    getLogger('app.domain.prompts.map_suggestions').info('business map suggestion skipped', {
      error_type: error instanceof ModelError ? error.code : 'deadline',
    });
    return [];
  }
}

/** Agent targeting as planned-cell facets, so selection and provenance see one shape. */
const TARGETING_FACETS = {
  place: 'market',
  persona: 'audience',
  constraint: 'situation_or_constraint',
} as const;
function agentNeed(
  offering: string,
  targeting: Partial<Record<keyof typeof TARGETING_FACETS, string>> = {},
) {
  const need: Record<string, string> = { offering };
  for (const [key, facet] of Object.entries(TARGETING_FACETS)) {
    const value = targeting[key as keyof typeof TARGETING_FACETS];
    if (value) need[facet] = value;
  }
  return need;
}

function proposal(context: GenerationContext) {
  const revision = context.revision!;
  const parsed = parsePromptProposal(revision.body, generationSetting('max_count'));
  if (!parsed)
    throw generationInvalid('Portfolio requires one JSON proposal with valid prompt rows');
  // A row filed under a topic that no longer exists is dropped on its own,
  // like any other inadmissible row, rather than failing the portfolio.
  const drops: Drops = {};
  const dropRecords: AdmissionDrop[] = [];
  const rows = parsed.rows.flatMap((row, index) => {
    const topic = context.selected.find((item) => item.id === row.topic_id);
    if (topic) return [{ row, topic, slot_id: `agent-${index + 1}` }];
    countDrop(drops, 'unknown_topic');
    dropRecords.push({
      reason: 'unknown_topic',
      slot_id: `agent-${index + 1}`,
      normalized_text_hash: promptTextHash(row.text),
      phase: 'admission',
      batch: 0,
      row_index: index,
    });
    return [];
  });
  const slots: Slot[] = rows.map(({ row, topic, slot_id }) => {
    const need = agentNeed(topic.name, row.targeting);
    return {
      slot_id,
      topic_id: topic.id,
      topic_name: topic.name,
      topic_description: topic.description,
      buyer_need: need,
      target_buyer_stage: '',
      allowed_prompt_intents: Object.keys(G.intent_legacy),
      evidence_ref: {
        kind: 'agent_output_revision',
        id: revision.id,
        ...need,
        evidence_type: 'hypothesis',
        review_state: 'suggested',
      },
    };
  });
  return {
    slots,
    rows: rows.map(({ row, slot_id }) => ({ ...row, slot_id })),
    drops,
    dropRecords,
  };
}

/** Model calls for one request's slots: every batch plus one refill batch. */
export const draftCallLimit = (count: number) =>
  Math.ceil(
    (count * generationSetting('overgenerate_factor')) / generationSetting('model_batch_size'),
  ) + 1;

/** Why a run stopped before every planned slot had a chance at admission. */
type Stop = z.infer<typeof promptGenerateResponseSchema.shape.shortfall_reason>;
const errorCode = (error: ModelError) =>
  error.status ? providerErrorCode(error.status) : error.code;

/**
 * Draft batches with bounded concurrency until every slot is admitted, the call
 * limit is spent, the deadline passes or the provider fails. Admission state is
 * merged in completion order; a failed batch never discards admitted drafts.
 */
async function draftBatches(
  context: GenerationContext,
  input: GenerationInput,
  gateway: ModelGateway,
  slots: Slot[],
  deadline: AbortSignal,
) {
  const batchSize = generationSetting('model_batch_size'),
    limit = draftCallLimit(input.count);
  const system = generationSystemPrompt(
    String(record(context.context.business_context).business_model),
    input.cohort,
    slots.some((slot) => slot.grounding?.length),
  );
  const drafts: Draft[] = [],
    models: unknown[] = [],
    drops: Drops = {},
    dropRecords: AdmissionDrop[] = [];
  const inFlight = new Set<string>();
  // The brief and tracked texts are fixed for the run: earlier drafts are not
  // fed back, so a first batch's register cannot set the whole run's.
  const brief = generationBrief(context);
  const tracked = context.prompts
    .map((row) => row.text)
    .slice(-generationSetting('existing_prompt_context_limit'));
  let calls = 0,
    parseError = false,
    failure: ModelError | null = null,
    crashed = false,
    cut = false;
  const nextBatch = () => {
    const accepted = new Set(drafts.map((row) => row.slot.slot_id));
    return slots
      .filter((slot) => !accepted.has(slot.slot_id) && !inFlight.has(slot.slot_id))
      .slice(0, batchSize);
  };
  const draftOne = async (call: number, batch: Slot[]) => {
    try {
      const response = await gateway.structured(
        system,
        JSON.stringify({
          reference_evidence: brief,
          slots: batch.map(modelSlot),
          existing_prompts: tracked,
        }),
        generated,
        deadline,
      );
      const { content: _content, ...identity } = response.result;
      models.push({ ...identity, batch: call });
      const result = admitDrafts(response.value.prompts, batch, context, input, drafts, call);
      drafts.push(...result.admitted);
      mergeDrops(drops, result.drops);
      dropRecords.push(...result.dropRecords);
    } catch (error) {
      // A batch cut at the deadline is a shortfall, not a provider failure.
      if (deadline.aborted) cut = true;
      else if (!(error instanceof ModelError)) throw error;
      else if (error.code === 'parse') parseError = true;
      else {
        failure ??= error;
        models.push({ batch: call, error_code: errorCode(error) });
      }
    }
  };
  // Each worker drafts one batch, then takes the next; a defect in one stops
  // the others from starting more provider calls.
  const worker = async (): Promise<void> => {
    if (failure || crashed || calls >= limit) return;
    const batch = nextBatch();
    if (!batch.length) return;
    if (deadline.aborted) {
      cut = true;
      return;
    }
    for (const slot of batch) inFlight.add(slot.slot_id);
    try {
      await draftOne(calls++, batch);
    } catch (error) {
      crashed = true;
      throw error;
    } finally {
      for (const slot of batch) inFlight.delete(slot.slot_id);
    }
    return worker();
  };
  await Promise.all(Array.from({ length: generationSetting('draft_concurrency') }, worker));
  if (!drafts.length && failure) throw failure;
  if (!drafts.length && parseError && !cut) throw new ModelError('parse');
  let stop: Stop = null;
  if (failure) stop = 'model_error';
  else if (cut) stop = 'deadline';
  return { drafts, drops, dropRecords, models, stop, reference: brief as unknown };
}

/**
 * Which of the project's searches grounded the run's plan: counts by source
 * and the exact searches attached to slots, with the classification that
 * admitted each. `searches_read` is every search admission checked copies
 * against. Never query text or volume.
 */
function groundingSummary(context: GenerationContext, slots: readonly Slot[]) {
  const used = new Map(
    slots.flatMap((slot) => slot.grounding ?? []).map((search) => [search.id, search]),
  );
  const searches = [...used.values()].map(observedRef);
  return {
    gsc: searches.filter((search) => search.source === 'gsc').length,
    search_intelligence: searches.filter((search) => search.source === 'search_intelligence')
      .length,
    slots_grounded: slots.filter((slot) => slot.grounding?.length).length,
    searches_read: context.observed.length,
    searches,
  };
}

export async function generateDrafts(
  context: GenerationContext,
  input: GenerationInput,
  gateway: ModelGateway | null,
  deadline: AbortSignal,
) {
  if (context.revision) {
    const { slots, rows, drops, dropRecords } = proposal(context);
    const admitted = admitDrafts(rows, slots, context, input, []);
    mergeDrops(drops, admitted.drops);
    return {
      drafts: admitted.admitted,
      drops,
      dropRecords: [...dropRecords, ...admitted.dropRecords],
      maps: [] as OfferingMap[],
      models: [] as unknown[],
      stop: null as Stop,
      reference: context.context as unknown,
      grounding: groundingSummary(context, []),
    };
  }
  if (!gateway) throw new ModelError('not_configured');
  const maps = await suggestMaps(gateway, context, deadline);
  const slots = planSlots(context, input, maps);
  return {
    ...(await draftBatches(context, input, gateway, slots, deadline)),
    maps,
    grounding: groundingSummary(context, slots),
  };
}
