import type { AccuracyClaim } from '@citeladder/contracts/fact-checking';
import { describe, expect, it } from 'vite-plus/test';

import { claimAgentPrompt, contradictedChange } from './accuracy';

const coverage = {
  claims: 10,
  supported: 5,
  contradicted: 0,
  inconclusive: 0,
  not_covered: 0,
  low_confidence: 0,
  pending: 0,
  unavailable: [],
  answers_pending: 0,
  answers_unavailable: 0,
  edited: 0,
};

const claim: AccuracyClaim = {
  claim: 'Pro costs $49 a month.',
  topic: 'pricing',
  quote: 'Pro is $49/month',
  status: 'verdict',
  verdict: 'contradicted',
  reason: null,
  facts: [{ topic: 'pricing', statement: 'Pro costs $59 per month.', source_url: null }],
  logical_engine: 'chatgpt',
  prompt: 'best tools?',
  run_id: '00000000-0000-4000-8000-000000000001',
  execution_id: '00000000-0000-4000-8000-000000000002',
  observed_at: '2026-11-01T00:00:00Z',
  verdict_id: null,
  edited: null,
};

describe('claimAgentPrompt', () => {
  it('names why a claim has no verdict instead of one shared "not checked"', () => {
    const states: Partial<AccuracyClaim>[] = [
      {},
      { status: 'low_confidence', verdict: null, facts: [] },
      { status: 'unavailable', verdict: null, reason: 'platform_cap', facts: [] },
    ];
    expect(
      states.map(
        (state) =>
          claimAgentPrompt({ ...claim, ...state }, 'ChatGPT').split(
            '(claim: Pro costs $49 a month.). ',
          )[1],
      ),
    ).toEqual([
      'Checked against our fact: "Pro costs $59 per month.". Verdict: contradicted.',
      'Verdict: low confidence.',
      'Verdict: unavailable (platform limit reached).',
    ]);
  });

  it('asks to correct only a contradicted claim', () => {
    const opening = (state: Partial<AccuracyClaim>) =>
      claimAgentPrompt({ ...claim, ...state }, 'ChatGPT').split(' Asked')[0];
    expect([
      opening({}),
      opening({ verdict: 'supported' }),
      opening({ verdict: 'inconclusive' }),
      opening({ status: 'pending', verdict: null }),
    ]).toEqual([
      'Help me correct what ChatGPT says about us.',
      'Help me keep what ChatGPT gets right about us accurate where it reads.',
      'Help me check what ChatGPT says about us.',
      'Help me check what ChatGPT says about us.',
    ]);
  });
});

describe('contradictedChange', () => {
  const point = (audit: string, contradicted: number, comparable = true) => ({
    audit_id: audit,
    completed_at: '2026-11-01T00:00:00Z',
    comparable,
    score: { accuracy: null, coverage: { ...coverage, contradicted } },
  });
  const [A, B] = ['00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b'];

  it('compares the one run shown with the comparable run before it, else nothing', () => {
    expect([
      contradictedChange({ source_audit_ids: [B], trend: [point(A, 7), point(B, 3)] }),
      contradictedChange({ source_audit_ids: [B], trend: [point(A, 7), point(B, 3, false)] }),
      contradictedChange({ source_audit_ids: [A, B], trend: [point(A, 7), point(B, 3)] }),
      contradictedChange({ source_audit_ids: [B], trend: [point(B, 3)] }),
    ]).toEqual([-4, null, null, null]);
  });
});
