import { afterEach, describe, expect, it, vi } from 'vitest';

import { policy } from '../src/config.ts';
import { ModelError } from '../src/models/http.ts';
import type { JevClient } from '../src/models/jev.ts';
import { bindingFailure } from '../src/prompts/binding.ts';
import type { GenerationContext } from '../src/prompts/generation-context.ts';
import { admitDrafts, type Draft } from '../src/prompts/generation-drafts.ts';
import { planSlots } from '../src/prompts/generation-plan.ts';
import { generationInput } from '../src/prompts/generation-input.ts';
import {
  applyQualityPolicy,
  judgeDrafts,
  selectDrafts,
} from '../src/prompts/generation-quality.ts';

const context = {
  prompts: [],
  candidates: [],
  maps: [],
  matching: {},
  selected: [{ id: 'topic', name: 'Dresses', description: '', parent_id: null }],
  topics: [{ id: 'topic', name: 'Dresses', description: '', parent_id: null }],
  context: {
    brand_name: 'Red Dress',
    brand_aliases: [],
    competitors: [{ name: 'Rival', aliases: [] }],
    business_context: { category: 'Maxi dresses' },
    demand_signals: [{ observed_query: 'best dresses online' }],
  },
  observed: [],
  vocabulary: { tokens: new Set(['dress', 'dresses']), phrases: new Set<string>() },
} as unknown as GenerationContext;

it('admits category language but rejects tracked identities, placeholders and copied observations', () => {
  const input = generationInput.parse({ count: 4 }),
    slots = planSlots(context, input, []);
  const texts = [
    'Which maxi dresses suit warm weather?',
    'Best Red Dress for summer?',
    'Which Rival dresses last longest?',
    'best dresses online',
    'Dresses near [city]',
    'Are reddress maxi dresses worth it?',
  ];
  const result = admitDrafts(
    texts.map((text, index) => ({
      text,
      slot_id: slots[index]!.slot_id,
      buyer_stage: 'decision',
      prompt_intent: 'recommend',
    })),
    slots,
    context,
    [],
  );
  expect(result.admitted.map((row) => row.text)).toEqual([texts[0]]);
  expect(result.drops).toEqual({ branded_core: 3, observed_copy: 1, placeholder: 1 });
});

it('drops an exact copy of any observed search the run read, not only demand signals', () => {
  const grounded = {
    ...context,
    observed: [
      {
        id: 'row',
        source: 'gsc' as const,
        text: 'which maxi dresses suit a beach wedding',
        topic_id: 'topic',
        weight: 40,
      },
    ],
  } as GenerationContext;
  const input = generationInput.parse({ count: 2 }),
    slots = planSlots(grounded, input, []);
  const texts = [
    'Which maxi dresses suit a beach wedding?',
    'Which maxi dresses suit a garden party?',
  ];
  const result = admitDrafts(
    texts.map((text, index) => ({
      text,
      slot_id: slots[index]!.slot_id,
      buyer_stage: 'decision',
      prompt_intent: 'recommend',
    })),
    slots,
    grounded,
    [],
  );
  expect(result.admitted.map((row) => row.text)).toEqual([texts[1]]);
  expect(result.drops).toEqual({ observed_copy: 1 });
});

it('requires the brand in diagnostics and a competitor comparison in the comparison cohort', () => {
  const admit = (cohort: 'brand_diagnostic' | 'comparison', texts: string[], intent: string) => {
    const input = generationInput.parse({ count: texts.length, cohort }),
      slots = planSlots(context, input, []);
    return admitDrafts(
      texts.map((text, index) => ({
        text,
        slot_id: slots[index]!.slot_id,
        buyer_stage: 'consideration',
        prompt_intent: intent,
      })),
      slots,
      context,
      [],
    );
  };
  const diagnostic = admit(
    'brand_diagnostic',
    ['Does Red Dress sell maxi dresses?', 'Which maxi dresses suit weddings?'],
    'validate',
  );
  expect(diagnostic.admitted.map((row) => row.text)).toEqual(['Does Red Dress sell maxi dresses?']);
  expect(diagnostic.drops).toEqual({ brand_missing: 1 });
  const comparison = admit(
    'comparison',
    [
      'Are Red Dress maxi dresses better than Rival dresses?',
      'Are Red Dress maxi dresses good value?',
      'Are Rival dresses better than other maxi dresses?',
    ],
    'compare',
  );
  expect(comparison.admitted.map((row) => row.text)).toEqual([
    'Are Red Dress maxi dresses better than Rival dresses?',
  ]);
  expect(comparison.drops).toEqual({ competitor_missing: 1, brand_missing: 1 });
});

it('drops a core or diagnostic draft joining two needs with "or", never a comparison', () => {
  const admit = (cohort: 'core' | 'brand_diagnostic' | 'comparison', texts: string[]) => {
    const slots = planSlots(context, generationInput.parse({ count: texts.length, cohort }), []);
    return admitDrafts(
      texts.map((text, index) => ({
        text,
        slot_id: slots[index]!.slot_id,
        buyer_stage: 'decision',
        prompt_intent: cohort === 'comparison' ? 'compare' : 'recommend',
      })),
      slots,
      context,
      [],
    );
  };
  const core = admit('core', [
    'Maxi dresses for a beach wedding or a garden party',
    'Maxi dresses for a beach wedding',
  ]);
  expect(core.admitted.map((row) => row.text)).toEqual(['Maxi dresses for a beach wedding']);
  expect(core.drops).toEqual({ two_needs: 1 });
  const diagnostic = admit('brand_diagnostic', [
    'Does Red Dress sell maxi or midi dresses?',
    'Does Red Dress sell maxi dresses for petite women?',
  ]);
  expect(diagnostic.admitted.map((row) => row.text)).toEqual([
    'Does Red Dress sell maxi dresses for petite women?',
  ]);
  expect(diagnostic.drops).toEqual({ two_needs: 1 });
  const comparison = admit('comparison', ['Red Dress or Rival for maxi dresses?']);
  expect(comparison.admitted.map((row) => row.text)).toEqual([
    'Red Dress or Rival for maxi dresses?',
  ]);
});

it('binds identities written in any script and still rejects unrelated text', () => {
  const vocabulary = { tokens: new Set(['unrelated']), phrases: new Set<string>() };
  expect(bindingFailure('सर्दियों के लिए सबसे अच्छे जूते कौन से हैं?', vocabulary, 'जूते')).toBeNull();
  expect(bindingFailure('哪些连衣裙适合夏天穿？', vocabulary, '连衣裙')).toBeNull();
  expect(bindingFailure('ชาอะไรเหมาะกับตอนเช้า', vocabulary, 'ชา')).toBeNull();
  expect(bindingFailure('วันนี้อากาศเป็นอย่างไร', vocabulary, 'ชา')).toBe('off_topic');
  expect(bindingFailure('Which café machines suit a small office?', vocabulary, 'Cafe')).toBeNull();
  expect(bindingFailure('आज मौसम कैसा है?', vocabulary, 'जूते')).toBe('off_topic');
  expect(bindingFailure('今天天气怎么样？', vocabulary, '连衣裙')).toBe('off_topic');
});

it('caps drafts at 16 words and drops near duplicates across topics, pending and tracked texts', () => {
  const second = { id: 'topic-2', name: 'Maxi dresses', description: '', parent_id: null };
  const seeded = {
    ...context,
    selected: [...context.selected, second],
    topics: [...context.topics, second],
    prompts: [
      {
        id: 'p',
        topic_id: 'topic',
        text: 'Best dresses for a summer beach wedding',
        normalized_text_hash: 'tracked',
      },
    ],
    candidates: [
      {
        text: 'Where can I buy linen dresses for hot weather?',
        normalized_text_hash: 'pending',
        disposition: 'pending',
        jev_decision: null,
      },
    ],
  } as unknown as GenerationContext;
  const slots = planSlots(seeded, generationInput.parse({ count: 3 }), []);
  const texts = [
    'Looking for dresses that work for a long office day with a commute and evening drinks after',
    'Best dresses for a beach wedding in summer',
    'Where can I buy linen dresses for very hot weather?',
    'Which dresses suit petite women at work?',
    'Which maxi dresses suit petite women at work?',
    'Looking for affordable dresses for a garden party',
  ];
  const result = admitDrafts(
    texts.map((text, index) => ({
      text,
      slot_id: slots[index]!.slot_id,
      buyer_stage: 'decision',
      prompt_intent: 'recommend',
    })),
    slots,
    seeded,
    [],
  );
  expect(result.admitted.map((row) => row.text)).toEqual([texts[3], texts[5]]);
  expect(result.drops).toEqual({ too_many_words: 1, near_duplicate: 3 });
  expect(result.dropRecords.map((row) => [row.reason, row.slot_id])).toEqual([
    ['too_many_words', slots[0]!.slot_id],
    ['near_duplicate', slots[1]!.slot_id],
    ['near_duplicate', slots[2]!.slot_id],
    ['near_duplicate', slots[4]!.slot_id],
  ]);
});

it('admits only planned stages for quick core rows, never after-purchase questions', () => {
  const slots = planSlots(context, generationInput.parse({ count: 1 }), []);
  const result = admitDrafts(
    [
      {
        text: 'Which maxi dresses are easy to alter at home?',
        slot_id: slots[0]!.slot_id,
        buyer_stage: 'implementation',
        prompt_intent: 'recommend',
      },
      {
        text: 'Best maxi dresses for a beach holiday',
        slot_id: slots[1]!.slot_id,
        buyer_stage: 'decision',
        prompt_intent: 'recommend',
      },
    ],
    slots,
    context,
    [],
  );
  expect(result.admitted.map((row) => row.text)).toEqual(['Best maxi dresses for a beach holiday']);
  expect(result.drops).toEqual({ stage: 1 });
  // Branded and comparison rows keep to the planned stages too.
  const branded = planSlots(
    context,
    generationInput.parse({ count: 1, cohort: 'brand_diagnostic' }),
    [],
  );
  const diagnostic = admitDrafts(
    [
      {
        text: 'How do I care for my Red Dress maxi dress after washing?',
        slot_id: branded[0]!.slot_id,
        buyer_stage: 'implementation',
        prompt_intent: 'validate',
      },
      {
        text: 'Does Red Dress sell maxi dresses for beach holidays?',
        slot_id: branded[1]!.slot_id,
        buyer_stage: 'consideration',
        prompt_intent: 'validate',
      },
    ],
    branded,
    context,
    [],
  );
  expect(diagnostic.admitted.map((row) => row.text)).toEqual([
    'Does Red Dress sell maxi dresses for beach holidays?',
  ]);
  expect(diagnostic.drops).toEqual({ stage: 1 });
});

/** Every yes/no question a core draft is asked, shared and core-only. */
const coreQuestions = Object.keys({
  ...policy.models.quality.noul_questions,
  ...policy.models.quality.core_noul_questions,
});

describe('JEV judgments', () => {
  const answers = Object.fromEntries(
    [...coreQuestions, ...Object.keys(policy.models.quality.brand_noul_questions)].map((key) => [
      key,
      { noul: 0.9 },
    ]),
  );
  const draft = (): Draft => ({
    slot: planSlots(context, generationInput.parse({ count: 1 }), [])[0]!,
    text: 'Which maxi dresses suit warm weather?',
    hash: 'hash',
    intent: 'purchase',
    buyer_stage: 'decision',
    prompt_intent: 'buy',
  });
  const judge = (decide: JevClient['decide']): JevClient => ({ model: 'jev-test', decide });
  afterEach(() => vi.unstubAllEnvs());

  it('reports the gate unavailable only when a judgment is missing', async () => {
    const failed = judge(async () => {
      throw new ModelError('http', 503);
    });
    expect(await judgeDrafts(context, [draft()], failed)).toBe('unavailable');
    const incomplete = [draft()];
    const partial = judge(async () => ({ model: 'jev-test', answers: {} }));
    expect(await judgeDrafts(context, incomplete, partial)).toBe('gate');
    expect(incomplete[0]!.decision?.flags).toContain(policy.models.quality.flag_incomplete);
  });

  it('reuses a recorded decision for an identical judgment without rewriting it', async () => {
    const first = [draft()];
    await judgeDrafts(
      context,
      first,
      judge(async () => ({ model: 'jev-test', answers })),
    );
    const stored = structuredClone(first[0]!.decision!);
    const cached = { ...context, candidates: [{ jev_decision: stored }] } as GenerationContext;
    const decide = vi.fn<JevClient['decide']>();
    const again = [draft()];
    expect(await judgeDrafts(cached, again, judge(decide))).toBe('gate');
    expect(decide).not.toHaveBeenCalled();
    expect(again[0]!.decision).toMatchObject({ state_hash: stored.state_hash, verdict: 'pass' });
    expect(cached.candidates[0]!.jev_decision).toEqual(stored);
  });

  it('reports the call cap as partial unavailability without marking unjudged rows', async () => {
    vi.stubEnv('JEV_MAX_CALLS_PER_GENERATION', '1');
    const drafts = [draft(), { ...draft(), text: 'Which maxi dresses suit a beach wedding?' }];
    const decide = vi.fn<JevClient['decide']>(async () => ({ model: 'jev-test', answers }));
    expect(await judgeDrafts(context, drafts, judge(decide))).toBe('unavailable');
    expect(decide).toHaveBeenCalledTimes(1);
    expect(drafts.filter((row) => row.decision === undefined)).toHaveLength(1);
  });

  it('propagates a policy defect instead of reporting the judge unavailable', async () => {
    vi.stubEnv('JEV_FAIL_BELOW', '0.9');
    await expect(
      judgeDrafts(
        context,
        [draft()],
        judge(async () => ({ model: 'jev-test', answers })),
      ),
    ).rejects.toThrow('Invalid JEV thresholds');
  });

  it('records but never removes strong failures in shadow mode', async () => {
    vi.stubEnv('JEV_MODE', 'shadow');
    const drafts = [draft()];
    const failing = judge(async () => ({
      model: 'jev-test',
      answers: { ...answers, decision_value: { noul: 0.01 } },
    }));
    expect(await judgeDrafts(context, drafts, failing)).toBe('shadow');
    expect(drafts[0]!.decision).toMatchObject({ verdict: 'fail', mode: 'shadow' });
    expect(selectDrafts(drafts, 1)).toHaveLength(1);
  });

  it('asks core drafts whether naming a business answers them, under its own thresholds', async () => {
    const asked: string[][] = [];
    const advice = judge(async (_state, questions) => {
      asked.push(Object.keys(questions));
      return { model: 'jev-test', answers: { ...answers, names_a_business: { noul: 0.1 } } };
    });
    const core = [draft()];
    await judgeDrafts(context, core, advice);
    expect(core[0]!.decision).toMatchObject({ verdict: 'fail', flags: ['names_a_business'] });
    const branded = [
      {
        ...draft(),
        slot: { ...draft().slot, cohort: 'brand_diagnostic' as const },
        text: 'Does Red Dress sell maxi dresses?',
      },
    ];
    await judgeDrafts(context, branded, advice);
    expect(branded[0]!.decision).toMatchObject({ verdict: 'pass', flags: [] });
    expect(asked.map((keys) => keys.includes('names_a_business'))).toEqual([true, false]);
    const borderline = applyQualityPolicy({
      cohort: 'core',
      answers: {
        ...Object.fromEntries(coreQuestions.map((key) => [key, 0.9])),
        names_a_business: 0.38,
      },
    });
    expect(borderline).toMatchObject({ verdict: 'uncertain', flags: ['names_a_business'] });
  });

  it('gates a branded draft that claims what its cell does not ground', async () => {
    const seen: { state: unknown; questions: string[] }[] = [];
    const ungrounded = judge(async (state, questions) => {
      seen.push({ state, questions: Object.keys(questions) });
      return { model: 'jev-test', answers: { ...answers, grounded_claims: { noul: 0.05 } } };
    });
    const slot = planSlots(
      context,
      generationInput.parse({ count: 1, cohort: 'brand_diagnostic' }),
      [],
    )[0]!;
    const branded = [{ ...draft(), slot, text: 'Compare Red Dress waterproof maxi dresses' }];
    await judgeDrafts(context, branded, ungrounded);
    expect(branded[0]!.decision).toMatchObject({ verdict: 'fail', flags: ['grounded_claims'] });
    expect(selectDrafts(branded, 1)).toEqual([]);
    expect(seen[0]!.state).toMatchObject({ grounded_attributes: ['Dresses'] });
    expect(seen[0]!.questions).toEqual(expect.arrayContaining(['single_need', 'grounded_claims']));
    expect(seen[0]!.questions).not.toContain('names_a_business');
    // A comparison also names a competitor the judge cannot tell apart, so its claims go unasked.
    const comparison = planSlots(
      context,
      generationInput.parse({ count: 1, cohort: 'comparison' }),
      [],
    )[0]!;
    await judgeDrafts(
      context,
      [{ ...draft(), slot: comparison, text: 'Red Dress or Rival for waterproof maxi dresses?' }],
      ungrounded,
    );
    expect(seen[1]!.questions).not.toContain('grounded_claims');
    expect(seen[1]!.state).not.toHaveProperty('grounded_attributes');
    // A core draft is asked whether it carries one need, and gated when it carries two.
    const core = [{ ...draft(), text: 'Maxi dresses for petite women and tall women' }];
    await judgeDrafts(
      context,
      core,
      judge(async () => ({
        model: 'jev-test',
        answers: { ...answers, single_need: { noul: 0.05 } },
      })),
    );
    expect(core[0]!.decision).toMatchObject({ verdict: 'fail', flags: ['single_need'] });
  });

  describe('topic filing', () => {
    const nets = { id: 'nets', name: 'Golf practice nets', description: '', parent_id: null };
    const packages = {
      id: 'packages',
      name: 'Golf net packages',
      description: '',
      parent_id: null,
    };
    const golf = {
      ...context,
      selected: [nets, packages],
      topics: [nets, packages],
    } as GenerationContext;
    const planned = () => {
      const slot = planSlots(golf, generationInput.parse({ count: 2 }), []).find(
        (item) => item.topic_id === 'packages',
      )!;
      return [{ ...draft(), slot, text: 'Compact golf practice net for a small basement' }];
    };
    const placing = (p: number) => {
      const criteria: unknown[] = [];
      const client = judge(async (_state, questions) => {
        criteria.push((questions.topic as { criteria: unknown }).criteria);
        return {
          model: 'jev-test',
          answers: { ...answers, topic: { choice: 't1', probabilities: { t1: p, t2: 1 - p } } },
        };
      });
      return { client, criteria };
    };

    it('files a draft under the topic the judge places it in, when confident', async () => {
      const drafts = planned();
      const { client, criteria } = placing(0.8);
      await judgeDrafts(golf, drafts, client);
      expect(criteria).toEqual([{ t1: 'Golf practice nets', t2: 'Golf net packages' }]);
      expect(drafts[0]!.slot).toMatchObject({ topic_id: 'nets', topic_name: 'Golf practice nets' });
      expect(drafts[0]!.decision).toMatchObject({ refiled_from_topic_id: 'packages' });
    });

    it('keeps the planned topic when the judge is unsure or only shadowing', async () => {
      const unsure = planned();
      await judgeDrafts(golf, unsure, placing(0.5).client);
      expect(unsure[0]!.slot.topic_id).toBe('packages');
      vi.stubEnv('JEV_MODE', 'shadow');
      const shadow = planned();
      await judgeDrafts(golf, shadow, placing(0.9).client);
      expect(shadow[0]!.slot.topic_id).toBe('packages');
      expect(shadow[0]!.decision).not.toHaveProperty('refiled_from_topic_id');
    });
  });
});

it('keeps incomplete judgments uncertain, gates strong failures and prefers passing drafts', () => {
  expect(applyQualityPolicy({ answers: {} }).verdict).toBe('uncertain');
  const answers = Object.fromEntries(coreQuestions.map((key) => [key, 0.9]));
  const input = generationInput.parse({ count: 2 }),
    slots = planSlots(context, input, []);
  const drafts: Draft[] = slots.slice(0, 3).map((slot, index) => ({
    slot,
    text: String(index),
    hash: String(index),
    intent: 'purchase',
    buyer_stage: 'decision',
    prompt_intent: 'buy',
  }));
  drafts[1]!.decision = applyQualityPolicy({ answers });
  drafts[2]!.decision = applyQualityPolicy({ answers: { ...answers, decision_value: 0.01 } });
  expect(selectDrafts(drafts, 1).map((row) => row.text)).toEqual(['1']);
  expect(selectDrafts(drafts, 3).map((row) => row.text)).toEqual(['0', '1']);
});
