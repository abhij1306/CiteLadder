import { afterEach, describe, expect, it, vi } from 'vitest';

import { policy } from '../src/config.ts';
import { ModelError } from '../src/models/http.ts';
import type { JevClient } from '../src/models/jev.ts';
import { bindingFailure } from '../src/prompts/binding.ts';
import type { GenerationContext } from '../src/prompts/generation-context.ts';
import { admitDrafts, type Draft } from '../src/prompts/generation-drafts.ts';
import { planSlots } from '../src/prompts/generation-plan.ts';
import { generationInput, validateSelection } from '../src/prompts/generation-input.ts';
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
    input,
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
    input,
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
      input,
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

it('refuses agent portfolios outside the core cohort', () => {
  expect(() =>
    validateSelection(
      generationInput.parse({ agent_revision_id: crypto.randomUUID(), cohort: 'comparison' }),
      [],
    ),
  ).toThrow(expect.objectContaining({ status: 422 }));
});

it('never combines excluded map facets and retains hypothesis provenance', () => {
  const entry = (value: string) => ({
    value,
    origin: 'manual' as const,
    review_state: 'confirmed' as const,
    reviewed_by: null,
    reviewed_at: null,
    source: {},
  });
  const slots = planSlots(context, generationInput.parse({ count: 8 }), [
    {
      offering: 'Dresses',
      attributes: [entry('silk')],
      situations: [entry('machine wash')],
      audiences: [],
      exclusions: [{ first: 'silk', second: 'machine wash' }],
    },
  ]);
  expect(
    slots.every(
      (slot) =>
        !(
          slot.buyer_need.attribute === 'silk' &&
          slot.buyer_need.situation_or_constraint === 'machine wash'
        ),
    ),
  ).toBe(true);
  expect(slots.some((slot) => slot.buyer_need.attribute === 'silk')).toBe(true);
  expect(slots[0]!.evidence_ref.evidence_type).toBe('hypothesis');
});

describe('JEV judgments', () => {
  const answers = Object.fromEntries(
    Object.keys(policy.models.quality.noul_questions).map((key) => [key, { noul: 0.9 }]),
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
});

it('keeps incomplete judgments uncertain, gates strong failures and prefers passing drafts', () => {
  expect(applyQualityPolicy({ answers: {} }).verdict).toBe('uncertain');
  const answers = Object.fromEntries(
    Object.keys(policy.models.quality.noul_questions).map((key) => [key, 0.9]),
  );
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
