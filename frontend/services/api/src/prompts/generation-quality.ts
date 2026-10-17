import { createHash } from 'node:crypto';
import { z } from 'zod';

import { policy, resolveSettingSpec } from '../config.ts';
import { record } from '../db/json.ts';
import { getLogger } from '../logging.ts';
import { ModelError, providerErrorCode } from '../models/http.ts';
import type { JevClient } from '../models/jev.ts';
import type { GenerationContext } from './generation-context.ts';
import type { Draft } from './generation-drafts.ts';

const Q = policy.models.quality;
const setting = (name: keyof typeof policy.models.jev) =>
  resolveSettingSpec(policy.models.jev[name]);
export const probability = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
const logger = getLogger('app.domain.prompts.quality_judge');

export function applyQualityPolicy(decision: Record<string, unknown>) {
  const thresholds = {
    flag_below: Number(setting('flag_below')),
    fail_below: Number(setting('fail_below')),
    duplicate_flag_at: Number(setting('duplicate_flag_at')),
    duplicate_fail_at: Number(setting('duplicate_fail_at')),
  };
  if (
    thresholds.fail_below > thresholds.flag_below ||
    thresholds.duplicate_fail_at < thresholds.duplicate_flag_at
  )
    throw new Error('Invalid JEV thresholds');
  const answers = record(decision.answers),
    duplicate = record(decision.duplicate_of);
  const values = Object.keys(Q.noul_questions).map(
    (key) => [key, probability(answers[key])] as const,
  );
  const duplicateP =
    duplicate.choice === Q.duplicate_none
      ? null
      : probability(record(duplicate.probabilities)[String(duplicate.choice)]);
  const flags = values
    .filter(([, value]) => value !== null && value < thresholds.flag_below)
    .map(([key]) => key);
  if (duplicateP !== null && duplicateP >= thresholds.duplicate_flag_at) flags.push('duplicate_of');
  if (
    values.some(([, value]) => value === null) ||
    (Object.keys(duplicate).length > 0 &&
      duplicate.choice !== Q.duplicate_none &&
      duplicateP === null)
  )
    flags.push(Q.flag_incomplete);
  const fail =
    values.some(([, value]) => value !== null && value < thresholds.fail_below) ||
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

/** The JEV question set; `duplicate_of` only when the topic has prior texts. */
function jevQuestions(options: Record<string, string>, hasPrior: boolean) {
  const questions: Record<string, unknown> = Object.fromEntries(
    Object.entries(Q.noul_questions).map(([key, value]) => [key, { type: 'noul', ...value }]),
  );
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
        candidate: { question: draft.text },
      };
      const questions = jevQuestions(options, texts.length > 0);
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
        draft.decision = applyQualityPolicy(cached);
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
        Object.keys(Q.noul_questions).map((key) => [key, probability(result.answers[key]?.noul)]),
      );
      const values = Object.values(answers).filter((value): value is number => value !== null);
      draft.decision = applyQualityPolicy({
        model: result.model,
        question_schema_version: Q.question_schema_version,
        state_hash: hash,
        answers,
        intent: choice(result.answers.intent, Object.keys(Q.intent_descriptions)),
        stage: choice(result.answers.stage, policy.prompts.generation.stages),
        duplicate_of: texts.length
          ? choice(result.answers.duplicate_of, [Q.duplicate_none, ...Object.keys(options)])
          : null,
        rank_score: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
        usage: result.usage ?? {},
      });
    }),
  );
  if (pendingAtDeadline) logger.warning('jev deadline reached', { pending: pendingAtDeadline });
  return unavailable ? 'unavailable' : z.enum(['gate', 'shadow']).parse(setting('mode'));
}

export const gatedOut = (draft: Draft) =>
  draft.decision?.mode === 'gate' && draft.decision.verdict === 'fail';

export function selectDrafts(drafts: Draft[], count: number): Draft[] {
  const remaining = drafts.filter((draft) => !gatedOut(draft)),
    selected: Draft[] = [];
  const usage = new Map<string, number>();
  const features = (draft: Draft) => [
    `topic:${draft.slot.topic_id}`,
    `stage:${draft.buyer_stage}`,
    `intent:${draft.prompt_intent}`,
    ...Object.entries(draft.slot.buyer_need).map(([key, value]) => `${key}:${value}`),
  ];
  const used = (key: string) => usage.get(key) ?? 0;
  const quality = (draft: Draft) =>
    draft.decision?.mode === 'gate' && draft.decision.verdict === 'pass' ? 0 : 1;
  while (remaining.length && selected.length < count) {
    remaining.sort(
      (a, b) =>
        quality(a) - quality(b) ||
        used(`topic:${a.slot.topic_id}`) - used(`topic:${b.slot.topic_id}`) ||
        features(a).reduce((sum, key) => sum + used(key), 0) -
          features(b).reduce((sum, key) => sum + used(key), 0) ||
        Number(a.slot.evidence_ref.review_state !== 'confirmed') -
          Number(b.slot.evidence_ref.review_state !== 'confirmed'),
    );
    const best = remaining.shift()!;
    selected.push(best);
    for (const key of features(best)) usage.set(key, used(key) + 1);
  }
  return selected.sort((a, b) => drafts.indexOf(a) - drafts.indexOf(b));
}
