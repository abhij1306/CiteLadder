/**
 * The deterministic core of fact-checking: which extracted claims survive,
 * how verdicts are downgraded, the claims addendum, and the accuracy metrics
 * with their coverage states.
 */
import { describe, expect, it } from 'vitest';

import { policy } from '../src/config.ts';
import {
  accuracySummary,
  claimStatus,
  type ClaimRow,
  type FactAnswer,
} from '../src/perception/fact-metrics.ts';
import { perceptionPrompt } from '../src/perception/model.ts';
import type { PerceptionPackage } from '../src/perception/passages.ts';
import { validateClaims } from '../src/perception/validate.ts';
import { validateVerdicts, verifyPackage } from '../src/perception/verify.ts';
import { checkedTopics, factScope, type FrozenFactCheck } from '../src/perception/admission.ts';

const facts = policy.perception.fact_check;
/** A frozen fact check with one fact per listed topic and the configured neighbours. */
const frozenWith = (...topics: FrozenFactCheck['facts'][number]['topic'][]): FrozenFactCheck => ({
  claims_version: 'c',
  verify_template_version: 'v',
  metrics_version: 'm',
  fact_set_hash: 'h',
  facts: topics.map((topic, index) => ({ revision_id: `rev-${index}`, topic })),
  related_topics: facts.related_topics,
});
const ownTopicOnly = (topic: FrozenFactCheck['facts'][number]['topic']) => [topic];
const BRAND = 'Acme Pro costs $49 per month. Acme integrates with Slack.';
const RIVAL = 'Rival costs $20 per month.';
const pkg: PerceptionPackage = {
  extractor_version: 'x',
  template_version: 't',
  language: 'en',
  prompt: 'best tools?',
  entities: [
    {
      entity_id: 'brand:acme',
      name: 'Acme',
      kind: 'brand',
      spans: [{ start: 0, end: [...BRAND].length, text: BRAND }],
    },
    {
      entity_id: 'competitor:rival',
      name: 'Rival',
      kind: 'competitor',
      spans: [{ start: 60, end: 60 + [...RIVAL].length, text: RIVAL }],
    },
  ],
};
const claim = (topic: string, quote: string, confidence = 0.9) => ({
  topic,
  claim: quote,
  quote,
  confidence,
});

describe('claim validation', () => {
  it("keeps brand claims quoted from the brand's passages and drops invented, competitor and off-topic quotes", () => {
    const result = validateClaims(
      pkg,
      [
        claim('pricing', 'Acme Pro costs $49 per month'),
        claim('pricing', 'Acme Pro costs $99 per month'),
        claim('pricing', 'Rival costs $20 per month'),
        claim('reputation', 'Acme integrates with Slack'),
        claim('integrations', 'Acme   integrates with Slack', 0.4),
      ],
      facts,
    );
    expect(result.claims).toEqual([
      {
        ordinal: 0,
        topic: 'pricing',
        claim: 'Acme Pro costs $49 per month',
        quote: 'Acme Pro costs $49 per month',
        start: 0,
        end: 28,
        confidence: 0.9,
        low_confidence: false,
      },
      {
        ordinal: 1,
        topic: 'integrations',
        claim: 'Acme   integrates with Slack',
        quote: 'Acme integrates with Slack',
        start: 30,
        end: 56,
        confidence: 0.4,
        low_confidence: true,
      },
    ]);
    expect(result.drops).toEqual({ claim_quote_not_found: 2, claim_off_topic: 1 });
  });

  it('caps claims per answer and drops a repeated quote', () => {
    const result = validateClaims(
      pkg,
      [
        claim('pricing', 'Acme Pro costs $49 per month'),
        claim('pricing', 'Acme Pro costs $49 per month'),
        claim('integrations', 'Acme integrates with Slack'),
      ],
      { ...facts, max_claims_per_answer: 1 },
    );
    expect(result.claims.map((row) => row.quote)).toEqual(['Acme Pro costs $49 per month']);
    expect(result.drops).toEqual({ claim_duplicate: 1, claim_limit: 1 });
  });

  it('drops every claim when the brand is not among the entities sent', () => {
    const result = validateClaims(
      { ...pkg, entities: pkg.entities.filter((entity) => entity.kind !== 'brand') },
      [claim('pricing', 'Rival costs $20 per month')],
      facts,
    );
    expect(result).toEqual({ claims: [], drops: { claim_no_brand: 1 } });
  });
});

describe('claims addendum', () => {
  it('appends the rendered addendum after whatever perception templates are configured', () => {
    const plain = perceptionPrompt(pkg, policy.perception);
    const withClaims = perceptionPrompt(pkg, policy.perception, {
      ...facts,
      topics: ['pricing', 'plans'],
      max_claims_per_answer: 3,
      claims_system_addendum: 'ADDENDUM',
      claims_user_addendum: 'Topics: {topics}; max {max_claims}',
    });
    expect(withClaims.system).toBe(`${plain.system}\n\nADDENDUM`);
    expect(withClaims.user).toBe(`${plain.user}\n\nTopics: pricing, plans; max 3`);
  });
});

describe('verdict validation', () => {
  const built = verifyPackage({
    version: 'v',
    brand: 'Acme',
    language: 'en',
    facts: [
      { revisionId: 'rev-price', topic: 'pricing', statement: 'Pro costs $59 per month.' },
      { revisionId: 'rev-hq', topic: 'company', statement: 'Founded in 2019.' },
    ],
    claims: [
      { claimId: 'claim-a', topic: 'pricing', claim: 'Pro is $49', quote: 'q1' },
      { claimId: 'claim-b', topic: 'pricing', claim: 'Pro is $59', quote: 'q2' },
      { claimId: 'claim-c', topic: 'pricing', claim: 'Pro has a trial', quote: 'q3' },
      { claimId: 'claim-d', topic: 'pricing', claim: 'Pro is monthly', quote: 'q4' },
    ],
    scope: ownTopicOnly,
    maxFacts: 20,
  });

  it('shares the fact cap across the claims topics instead of filling it with the first topic', () => {
    const shared = verifyPackage({
      version: 'v',
      brand: 'Acme',
      language: 'en',
      facts: [
        { revisionId: 'p1', topic: 'pricing', statement: 'Pro costs $59.' },
        { revisionId: 'p2', topic: 'pricing', statement: 'Team costs $99.' },
        { revisionId: 'p3', topic: 'pricing', statement: 'Annual saves 20%.' },
        { revisionId: 'i1', topic: 'integrations', statement: 'Works with Slack.' },
      ],
      claims: [
        { claimId: 'a', topic: 'pricing', claim: 'x', quote: 'x' },
        { claimId: 'b', topic: 'integrations', claim: 'y', quote: 'y' },
      ],
      scope: ownTopicOnly,
      maxFacts: 2,
    });
    expect(shared.pkg.facts.map((fact) => fact.statement)).toEqual([
      'Pro costs $59.',
      'Works with Slack.',
    ]);
  });

  it('checks a claim filed under an adjacent topic against the fact that decides it', () => {
    const factCheck = frozenWith('specs', 'markets');
    // A plan's contents filed under plans, and a country filed under availability.
    const built = verifyPackage({
      version: 'v',
      brand: 'Acme',
      language: 'en',
      facts: [
        { revisionId: 'rev-0', topic: 'specs', statement: 'The Team plan includes 50 projects.' },
        { revisionId: 'rev-1', topic: 'markets', statement: 'Sold in the US and Canada only.' },
        { revisionId: 'rev-2', topic: 'company', statement: 'Founded in 2016.' },
      ],
      claims: [
        { claimId: 'a', topic: 'plans', claim: 'Unlimited projects', quote: 'q1' },
        { claimId: 'b', topic: 'availability', claim: 'Available in Germany', quote: 'q2' },
      ],
      scope: (topic) => factScope(factCheck, topic),
      maxFacts: 20,
    });
    expect(built.pkg.facts.map((fact) => fact.statement)).toEqual([
      'The Team plan includes 50 projects.',
      'Sold in the US and Canada only.',
    ]);
    expect([...checkedTopics(factCheck)].sort()).toEqual([
      'availability',
      'integrations',
      'markets',
      'plans',
      'specs',
    ]);
  });

  it('sends only facts on the claims topics, under local ids', () => {
    expect(built.pkg.facts).toEqual([
      { fact_id: 'f1', topic: 'pricing', statement: 'Pro costs $59 per month.' },
    ]);
    expect(built.pkg.claims.map((row) => row.claim_id)).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('strips unsent facts, downgrades unsupported and weak contradictions, and fills missing claims', () => {
    const result = validateVerdicts(
      {
        verdicts: [
          { claim_id: 'c1', verdict: 'contradicted', fact_ids: ['f1', 'f9'], confidence: 0.9 },
          { claim_id: 'c2', verdict: 'supported', fact_ids: ['f9'], confidence: 0.95 },
          { claim_id: 'c3', verdict: 'contradicted', fact_ids: ['f1'], confidence: 0.7 },
          { claim_id: 'c9', verdict: 'supported', fact_ids: ['f1'], confidence: 0.9 },
        ],
      },
      built,
      facts,
    );
    expect(
      result.verdicts.map((row) => [
        row.claimId,
        row.verdict,
        row.factRevisionIds,
        row.lowConfidence,
      ]),
    ).toEqual([
      ['claim-a', 'contradicted', ['rev-price'], false],
      ['claim-b', 'inconclusive', [], false],
      ['claim-c', 'inconclusive', ['rev-price'], true],
      ['claim-d', 'not_covered', [], false],
    ]);
    expect(result.drops).toEqual({
      unknown_fact: 2,
      verdict_without_fact: 1,
      low_confidence_contradiction: 1,
      unknown_claim: 1,
      missing_claim: 1,
    });
  });
});

describe('accuracy metrics', () => {
  const row = (ordinal: number, status: ClaimRow['status']): ClaimRow => ({
    ordinal,
    claim: `claim ${ordinal}`,
    topic: 'pricing',
    quote: `quote ${ordinal}`,
    start: 0,
    end: 5,
    status,
    facts: [],
  });
  const answer = (overrides: Partial<FactAnswer>): FactAnswer => ({
    auditId: '00000000-0000-4000-8000-000000000001',
    executionId: '00000000-0000-4000-8000-0000000000aa',
    observedAt: '2026-10-01T00:00:00Z',
    logicalEngine: 'chatgpt',
    prompt: 'best tools?',
    identity: 'set-a',
    extraction: { kind: 'done' },
    claims: [],
    citations: [],
    ...overrides,
  });

  it('computes accuracy over supported and contradicted only, with every other bucket counted', () => {
    const summary = accuracySummary(
      [
        answer({
          claims: [
            row(0, { kind: 'verdict', verdict: 'supported' }),
            row(1, { kind: 'verdict', verdict: 'supported' }),
            row(2, { kind: 'verdict', verdict: 'contradicted' }),
            row(3, { kind: 'verdict', verdict: 'not_covered' }),
            row(4, { kind: 'low_confidence' }),
            row(5, { kind: 'unavailable', reason: 'platform_cap' }),
          ],
          citations: [{ domain: 'reviews.example', url: 'https://reviews.example/acme' }],
        }),
        answer({
          executionId: '00000000-0000-4000-8000-0000000000bb',
          extraction: { kind: 'pending' },
        }),
      ],
      true,
      facts,
    );
    expect(summary.state).toBe('value');
    expect(summary.score).toEqual({
      accuracy: 2 / 3,
      coverage: {
        claims: 6,
        supported: 2,
        contradicted: 1,
        inconclusive: 0,
        not_covered: 1,
        low_confidence: 1,
        pending: 0,
        unavailable: [{ reason: 'platform_cap', count: 1 }],
        answers_pending: 1,
        answers_unavailable: 0,
      },
    });
    expect(summary.contradicted.map((claim) => claim.quote)).toEqual(['quote 2']);
    expect(summary.cited_alongside).toEqual([
      { domain: 'reviews.example', answers: 1, example_url: 'https://reviews.example/acme' },
    ]);
  });

  it('reads no claims, pending and unavailable as states without an accuracy, never zero', () => {
    const none = accuracySummary([answer({})], true, facts);
    expect([none.state, none.score.accuracy]).toEqual(['no_claims', null]);
    const pending = accuracySummary(
      [answer({ claims: [row(0, { kind: 'pending' })] })],
      true,
      facts,
    );
    expect([pending.state, pending.score.accuracy]).toEqual(['pending', null]);
    const failed = accuracySummary(
      [answer({ extraction: { kind: 'unavailable', reason: 'model_error' } })],
      true,
      facts,
    );
    expect([failed.state, failed.reason]).toEqual(['unavailable', 'model_error']);
    // A checked run whose answers never named the brand has no claims, not no facts.
    expect(accuracySummary([], true, facts).state).toBe('no_claims');
    expect(accuracySummary([], false, facts).state).toBe('no_facts');
  });

  it('marks a trend point not comparable when the fact set or versions change', () => {
    const summary = accuracySummary(
      [
        answer({
          auditId: '00000000-0000-4000-8000-000000000001',
          observedAt: '2026-10-01T00:00:00Z',
        }),
        answer({
          auditId: '00000000-0000-4000-8000-000000000002',
          observedAt: '2026-10-02T00:00:00Z',
        }),
        answer({
          auditId: '00000000-0000-4000-8000-000000000003',
          observedAt: '2026-10-03T00:00:00Z',
          identity: 'set-b',
        }),
      ],
      true,
      facts,
    );
    expect(summary.trend.map((point) => point.comparable)).toEqual([true, true, false]);
  });

  it('derives a claim status from its own confidence, the frozen topics and the verification', () => {
    const verified = { outcome: 'verified', outcome_reason: null };
    const supported = { verdict: 'supported' as const, low_confidence: false };
    expect([
      claimStatus({
        lowConfidenceClaim: true,
        topicHasFact: true,
        verification: verified,
        verdict: supported,
      }),
      claimStatus({
        lowConfidenceClaim: false,
        topicHasFact: false,
        verification: undefined,
        verdict: undefined,
      }),
      claimStatus({
        lowConfidenceClaim: false,
        topicHasFact: true,
        verification: undefined,
        verdict: undefined,
      }),
      claimStatus({
        lowConfidenceClaim: false,
        topicHasFact: true,
        verification: { outcome: 'unavailable', outcome_reason: 'model_not_configured' },
        verdict: undefined,
      }),
      claimStatus({
        lowConfidenceClaim: false,
        topicHasFact: true,
        verification: verified,
        verdict: supported,
      }),
    ]).toEqual([
      { kind: 'low_confidence' },
      { kind: 'verdict', verdict: 'not_covered' },
      { kind: 'pending' },
      { kind: 'unavailable', reason: 'model_not_configured' },
      { kind: 'verdict', verdict: 'supported' },
    ]);
  });
});
