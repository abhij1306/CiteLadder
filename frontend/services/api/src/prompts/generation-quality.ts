import { createHash } from 'node:crypto';
import { z } from 'zod';

import { policy, resolveSettingSpec } from '../config.ts';
import { record } from '../db/json.ts';
import { getLogger } from '../logging.ts';
import { ModelError, providerErrorCode } from '../models/http.ts';
import type { JevClient } from '../models/jev.ts';
import type { GenerationContext } from './generation-context.ts';
import type { Draft } from './generation-drafts.ts';
import {
  cohortShares,
  generationCohorts,
  type GenerationCohort,
  type GenerationInput,
} from './generation-input.ts';

const Q = policy.models.quality;
const setting = (name: keyof typeof policy.models.jev) =>
  resolveSettingSpec(policy.models.jev[name]);
export const probability = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
const logger = getLogger('app.domain.prompts.quality_judge');

/**
 * The yes/no questions a draft of `cohort` is asked: core drafts add the
 * core-only ones, brand diagnostics the brand-only ones. A comparison names a
 * competitor too, and the judge's state names neither business, so it could
 * hold a competitor's feature against the tracked brand's attributes.
 */
export const noulQuestions = (cohort: unknown) => ({
  ...Q.noul_questions,
  ...(cohort === 'core' ? Q.core_noul_questions : {}),
  ...(cohort === 'brand_diagnostic' ? Q.brand_noul_questions : {}),
});

export function applyQualityPolicy(decision: Record<string, unknown>) {
  const thresholds = {
    flag_below: Number(setting('flag_below')),
    fail_below: Number(setting('fail_below')),
    answerable_flag_below: Number(setting('answerable_flag_below')),
    answerable_fail_below: Number(setting('answerable_fail_below')),
    duplicate_flag_at: Number(setting('duplicate_flag_at')),
    duplicate_fail_at: Number(setting('duplicate_fail_at')),
  };
  if (
    thresholds.fail_below > thresholds.flag_below ||
    thresholds.answerable_fail_below > thresholds.answerable_flag_below ||
    thresholds.duplicate_fail_at < thresholds.duplicate_flag_at
  )
    throw new Error('Invalid JEV thresholds');
  const answers = record(decision.answers),
    duplicate = record(decision.duplicate_of);
  // A decision recorded without a cohort was a core draft's.
  const values = Object.keys(noulQuestions(decision.cohort ?? 'core')).map((key) => {
    const core = Object.hasOwn(Q.core_noul_questions, key);
    return {
      key,
      value: probability(answers[key]),
      flagBelow: core ? thresholds.answerable_flag_below : thresholds.flag_below,
      failBelow: core ? thresholds.answerable_fail_below : thresholds.fail_below,
    };
  });
  const duplicateP =
    duplicate.choice === Q.duplicate_none
      ? null
      : probability(record(duplicate.probabilities)[String(duplicate.choice)]);
  const flags = values
    .filter(({ value, flagBelow }) => value !== null && value < flagBelow)
    .map(({ key }) => key);
  if (duplicateP !== null && duplicateP >= thresholds.duplicate_flag_at) flags.push('duplicate_of');
  if (
    values.some(({ value }) => value === null) ||
    (Object.keys(duplicate).length > 0 &&
      duplicate.choice !== Q.duplicate_none &&
      duplicateP === null)
  )
    flags.push(Q.flag_incomplete);
  const fail =
    values.some(({ value, failBelow }) => value !== null && value < failBelow) ||
    (duplicateP !== null && duplicateP >= thresholds.duplicate_fail_at);
  let verdict = flags.length ? 'uncertain' : 'pass';
  if (fail) verdict = 'fail';
  return {
    ...decision,
    thresholds,
    flags,
    mode: String(setting('mode')),
    policy_version: Q.policy_version,
    verdict,
  };
}

function choice(value: unknown, allowed: readonly string[]) {
  const answer = record(value);
  return {
    choice:
      typeof answer.choice === 'string' && allowed.includes(answer.choice) ? answer.choice : null,
    probabilities: Object.fromEntries(
      Object.entries(record(answer.probabilities)).filter(
        ([key, value]) => allowed.includes(key) && probability(value) !== null,
      ),
    ),
    confidence: probability(answer.confidence),
  };
}

/**
 * The JEV question set: `duplicate_of` only when the topic has prior texts,
 * `topic` only when the run spans several topics.
 */
function jevQuestions({
  options,
  hasPrior,
  cohort,
  topics,
}: {
  options: Record<string, string>;
  hasPrior: boolean;
  cohort: string;
  topics: Record<string, string>;
}) {
  const questions: Record<string, unknown> = Object.fromEntries(
    Object.entries(noulQuestions(cohort)).map(([key, value]) => [key, { type: 'noul', ...value }]),
  );
  if (Object.keys(topics).length > 1)
    questions.topic = { type: 'choice', instructions: Q.topic_instructions, criteria: topics };
  questions.intent = {
    type: 'choice',
    instructions: Q.intent_instructions,
    criteria: Q.intent_descriptions,
  };
  questions.stage = {
    type: 'choice',
    instructions: Q.stage_instructions,
    criteria: Q.stage_descriptions,
  };
  if (hasPrior)
    questions.duplicate_of = {
      type: 'choice',
      instructions: Q.duplicate_instructions,
      criteria: { [Q.duplicate_none]: Q.duplicate_none_description, ...options },
    };
  return questions;
}

type TopicOption = { key: string; topic: GenerationContext['selected'][number] };

/** The run's selected topics as the judge's topic choices, keyed `t1`, `t2`, … in order. */
const topicOptions = (context: GenerationContext): TopicOption[] =>
  context.selected.map((topic, index) => ({ key: `t${index + 1}`, topic }));

/**
 * File a gated draft under the topic the judge places it in, when that is
 * another selected topic chosen with at least `topic_refile_at` probability.
 * The cell (offering, facet, stage) stays as planned; the decision records
 * the topic it was planned under. Shadow mode only records the choice.
 */
function refile(
  draft: Draft,
  { refiled_from_topic_id: _recorded, ...decision }: Record<string, unknown>,
  options: TopicOption[],
) {
  const answer = record(decision.topic);
  const chosen = options.find(({ key }) => key === answer.choice)?.topic;
  const p = probability(record(answer.probabilities)[String(answer.choice)]);
  if (
    decision.mode !== 'gate' ||
    !chosen ||
    chosen.id === draft.slot.topic_id ||
    p === null ||
    p < Q.topic_refile_at
  )
    return decision;
  const planned = draft.slot.topic_id;
  draft.slot = {
    ...draft.slot,
    topic_id: chosen.id,
    topic_name: chosen.name,
    topic_description: chosen.description,
  };
  return { ...decision, refiled_from_topic_id: planned };
}

function jevErrorCode(error: ModelError) {
  if (error.status) return providerErrorCode(error.status);
  return error.code === 'parse' ? 'parse_error' : error.code;
}

function logJudgeFailure(error: unknown) {
  if (error instanceof ModelError)
    logger.warning('jev decision unavailable', { error_code: jevErrorCode(error) });
  else
    logger.warning('jev decision malformed', {
      error_type: error instanceof Error ? error.name : typeof error,
    });
}

/** All inputs are already committed. No database connection spans a JEV call. */
export async function judgeDrafts(
  context: GenerationContext,
  drafts: Draft[],
  judge: JevClient | null,
): Promise<'off' | 'gate' | 'shadow' | 'unavailable'> {
  if (!judge) return 'off';
  const deadline = AbortSignal.timeout(Number(setting('generation_deadline_seconds')) * 1000);
  let pendingAtDeadline = 0;
  const prior = new Map<string, string[]>();
  for (const prompt of context.prompts)
    if (prompt.topic_id)
      prior.set(prompt.topic_id, [...(prior.get(prompt.topic_id) ?? []), prompt.text]);
  const cache = new Map(
    context.candidates.flatMap((row) => {
      const decision = record(row.jev_decision);
      return typeof decision.state_hash === 'string'
        ? [[decision.state_hash, decision] as const]
        : [];
    }),
  );
  const business = record(context.context.business_context);
  const safeBusiness = Object.fromEntries(
    [
      'category',
      'category_terms',
      'jobs_to_be_done',
      'products_services',
      'target_audience',
      'buyer_roles',
    ]
      .filter((key) => business[key])
      .map((key) => [key, business[key]]),
  );
  const runTopics = topicOptions(context);
  const topics = Object.fromEntries(
    runTopics.map(({ key, topic }) => [
      key,
      topic.description ? `${topic.name}: ${topic.description}` : topic.name,
    ]),
  );
  let calls = 0,
    unavailable = false;
  await Promise.all(
    drafts.map(async (draft) => {
      const texts = prior.get(draft.slot.topic_id) ?? [];
      const options = Object.fromEntries(
        texts
          .slice(-Number(setting('duplicate_options_max')))
          .map((text, index) => [`p${index + 1}`, text]),
      );
      prior.set(draft.slot.topic_id, [...texts, draft.text]);
      const state = {
        business: safeBusiness,
        topic: draft.slot.topic_name,
        buyer_need: draft.slot.buyer_need,
        // A branded draft's claims are judged against what its cell may claim.
        ...(draft.slot.grounded_attributes
          ? { grounded_attributes: draft.slot.grounded_attributes }
          : {}),
        candidate: { question: draft.text },
      };
      const questions = jevQuestions({
        options,
        hasPrior: texts.length > 0,
        cohort: draft.slot.cohort,
        topics,
      });
      const hash = createHash('sha256')
        .update(
          JSON.stringify({
            state,
            questions,
            model: judge.model,
            question_schema_version: Q.question_schema_version,
          }),
        )
        .digest('hex');
      const cached = cache.get(hash);
      if (cached) {
        draft.decision = refile(draft, applyQualityPolicy(cached), runTopics);
        return;
      }
      if (calls >= Number(setting('max_calls_per_generation'))) {
        unavailable = true;
        return;
      }
      calls++;
      // Only the judge call can make a decision unavailable; a failure in
      // applying policy is a defect and propagates, as on the cached path.
      let result: Awaited<ReturnType<JevClient['decide']>>;
      try {
        result = await judge.decide(state, questions, deadline);
      } catch (error) {
        unavailable = true;
        if (deadline.aborted) pendingAtDeadline++;
        else logJudgeFailure(error);
        return;
      }
      const answers = Object.fromEntries(
        Object.keys(noulQuestions(draft.slot.cohort)).map((key) => [
          key,
          probability(result.answers[key]?.noul),
        ]),
      );
      const values = Object.values(answers).filter((value): value is number => value !== null);
      const decision = applyQualityPolicy({
        model: result.model,
        question_schema_version: Q.question_schema_version,
        cohort: draft.slot.cohort,
        state_hash: hash,
        answers,
        intent: choice(result.answers.intent, Object.keys(Q.intent_descriptions)),
        stage: choice(result.answers.stage, policy.prompts.generation.stages),
        topic: questions.topic ? choice(result.answers.topic, Object.keys(topics)) : null,
        duplicate_of: texts.length
          ? choice(result.answers.duplicate_of, [Q.duplicate_none, ...Object.keys(options)])
          : null,
        rank_score: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
        usage: result.usage ?? {},
      });
      draft.decision = refile(draft, decision, runTopics);
    }),
  );
  if (pendingAtDeadline) logger.warning('jev deadline reached', { pending: pendingAtDeadline });
  return unavailable ? 'unavailable' : z.enum(['gate', 'shadow']).parse(setting('mode'));
}

export const gatedOut = (draft: Draft) =>
  draft.decision?.mode === 'gate' && draft.decision.verdict === 'fail';

/**
 * Each cohort's share of `count` by largest remainder: a single-cohort run
 * keeps the whole count in its cohort.
 */
export function cohortQuotas(
  input: Pick<GenerationInput, 'count' | 'cohort' | 'distribution'>,
): Record<GenerationCohort, number> {
  const shares = cohortShares(input);
  const exact = generationCohorts.map((cohort) => ({
    cohort,
    value: shares[cohort] * input.count,
  }));
  const quotas: Record<GenerationCohort, number> = { core: 0, brand_diagnostic: 0, comparison: 0 };
  for (const { cohort, value } of exact) quotas[cohort] = Math.floor(value);
  let left = input.count - Object.values(quotas).reduce((sum, value) => sum + value, 0);
  // A stable sort: equal remainders keep cohort order.
  for (const { cohort, value } of exact.toSorted(
    (a, b) => b.value - Math.floor(b.value) - (a.value - Math.floor(a.value)),
  )) {
    if (left <= 0) break;
    if (value <= 0) continue;
    quotas[cohort] += 1;
    left -= 1;
  }
  return quotas;
}

/**
 * Selection for a run: each cohort fills its own quota from its own drafts,
 * so a cohort's shortfall is reported, never filled from another cohort.
 * Topics share each quota by the plan's `topicWeights`.
 */
export function selectRun(
  drafts: Draft[],
  input: Pick<GenerationInput, 'count' | 'cohort' | 'distribution'>,
  topicWeights: ReadonlyMap<string, number> = new Map(),
): Draft[] {
  const quotas = cohortQuotas(input);
  return generationCohorts
    .flatMap((cohort) =>
      selectDrafts(
        drafts.filter((draft) => draft.slot.cohort === cohort),
        quotas[cohort],
        { balanceStages: !input.distribution?.intent_mix, topicWeights },
      ),
    )
    .sort((a, b) => drafts.indexOf(a) - drafts.indexOf(b));
}

/**
 * Up to `count` drafts, passing judgments first, then every topic once
 * before any twice, then topics by weight (highest averages, so a topic
 * weighing twice another gets about twice its prompts; unlisted topics weigh
 * one), spread across stage, intent and the cell's facets. A requested intent
 * mix already weighted the planned stages, so `balanceStages: false` keeps
 * selection from evening it out.
 */
export function selectDrafts(
  drafts: Draft[],
  count: number,
  {
    balanceStages = true,
    topicWeights = new Map(),
  }: { balanceStages?: boolean; topicWeights?: ReadonlyMap<string, number> } = {},
): Draft[] {
  const remaining = drafts.filter((draft) => !gatedOut(draft)),
    selected: Draft[] = [];
  const usage = new Map<string, number>();
  const features = (draft: Draft) => [
    `topic:${draft.slot.topic_id}`,
    ...(balanceStages ? [`stage:${draft.buyer_stage}`] : []),
    `intent:${draft.prompt_intent}`,
    ...Object.entries(draft.slot.buyer_need).map(([key, value]) => `${key}:${value}`),
  ];
  const used = (key: string) => usage.get(key) ?? 0;
  // An unused topic comes first; then the topic whose next prompt keeps its
  // count closest to its weight's share (the inverse Sainte-Laguë quotient).
  const topicDemand = (draft: Draft) => {
    const taken = used(`topic:${draft.slot.topic_id}`);
    return taken ? (2 * taken + 1) / (topicWeights.get(draft.slot.topic_id) ?? 1) : 0;
  };
  const quality = (draft: Draft) =>
    draft.decision?.mode === 'gate' && draft.decision.verdict === 'pass' ? 0 : 1;
  // A facet a person confirmed in the map or requested for this run comes first.
  const chosenByPerson = (draft: Draft) =>
    ['confirmed', 'requested'].includes(String(draft.slot.evidence_ref.review_state));
  while (remaining.length && selected.length < count) {
    remaining.sort(
      (a, b) =>
        quality(a) - quality(b) ||
        topicDemand(a) - topicDemand(b) ||
        features(a).reduce((sum, key) => sum + used(key), 0) -
          features(b).reduce((sum, key) => sum + used(key), 0) ||
        Number(chosenByPerson(b)) - Number(chosenByPerson(a)),
    );
    const best = remaining.shift()!;
    selected.push(best);
    for (const key of features(best)) usage.set(key, used(key) + 1);
  }
  return selected.sort((a, b) => drafts.indexOf(a) - drafts.indexOf(b));
}
