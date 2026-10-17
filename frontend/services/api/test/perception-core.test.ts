import { describe, expect, it } from 'vitest';

import { scoringConfig } from '../src/analysis/scoring.ts';
import { policy } from '../src/config.ts';
import { entityPassages, namesAnyEntity, packageHash } from '../src/perception/passages.ts';
import { perceptionPrompt } from '../src/perception/model.ts';
import { locateQuote, validateOutput } from '../src/perception/validate.ts';
import {
  coverage,
  mentionStatus,
  perceptionSummary,
  readState,
  score,
  type Mention,
  type PerceptionAnswer,
} from '../src/perception/metrics.ts';

const config = scoringConfig({
  brand_name: 'Acme',
  competitors: [
    { name: 'Rival', domains: [] },
    { name: 'Other Co', domains: [] },
  ],
});
const limits = { max_entities: 8, max_passage_chars_per_entity: 1200 };

function pkgFor(answer: string) {
  return {
    extractor_version: 'x1',
    template_version: 't1',
    language: 'en',
    prompt: 'best tools?',
    entities: entityPassages({ answer, languageCode: 'en', config, policy: limits }),
  };
}

describe('perception passages', () => {
  it('sends the naming sentence plus one either side, brand first, competitors by first mention', () => {
    const answer =
      'Intro line. Then more. Rival is cheap. Filler one. Filler two. Filler three. Acme is great. Acme support is slow. End.';
    expect(entityPassages({ answer, languageCode: 'en', config, policy: limits })).toEqual([
      {
        entity_id: 'brand:acme',
        name: 'Acme',
        kind: 'brand',
        spans: [
          { start: 63, end: 118, text: 'Filler three. Acme is great. Acme support is slow. End.' },
        ],
      },
      {
        entity_id: 'competitor:rival',
        name: 'Rival',
        kind: 'competitor',
        spans: [{ start: 12, end: 50, text: 'Then more. Rival is cheap. Filler one.' }],
      },
    ]);
  });

  it('stores code-point offsets with astral and CJK text before the mention', () => {
    const answer = '😀😀 很好。Acme 很好。';
    const [brand] = entityPassages({ answer, languageCode: 'zh', config, policy: limits });
    const span = brand!.spans[0]!;
    expect(Array.from(answer).slice(span.start, span.end).join('')).toBe(span.text);
    expect(span.start).toBe(0);
    expect(locateQuote('Acme 很好', brand!.spans)).toEqual({
      start: 6,
      end: 13,
      text: 'Acme 很好',
    });
  });

  it('caps each entity passage budget in code points', () => {
    const answer = `Acme ${'x'.repeat(50)}.`;
    const [brand] = entityPassages({
      answer,
      languageCode: 'en',
      config,
      policy: { max_entities: 8, max_passage_chars_per_entity: 10 },
    });
    expect(brand!.spans).toEqual([{ start: 0, end: 10, text: 'Acme xxxxx' }]);
  });

  it('keeps a late mention inside a window cut to the budget', () => {
    const answer = `${'x'.repeat(40)} Acme is great.`;
    const [brand] = entityPassages({
      answer,
      languageCode: 'en',
      config,
      policy: { max_entities: 8, max_passage_chars_per_entity: 12 },
    });
    expect(brand!.spans).toEqual([{ start: 35, end: 47, text: 'xxxxx Acme i' }]);
  });

  it('hashes equal packages equally whatever their key order', () => {
    const pkg = pkgFor('Acme is great.');
    const reordered = {
      entities: pkg.entities,
      prompt: pkg.prompt,
      language: 'en',
      template_version: 't1',
      extractor_version: 'x1',
    };
    expect(packageHash(reordered)).toBe(packageHash(pkg));
    expect(packageHash({ ...pkg, prompt: 'other' })).not.toBe(packageHash(pkg));
  });

  it('enqueues only for an answer naming someone', () => {
    expect(namesAnyEntity([{ state: 'absent' }, { state: 'hedged' }])).toBe(true);
    expect(namesAnyEntity([{ state: 'absent' }, { state: 'unavailable' }])).toBe(false);
    expect(namesAnyEntity([])).toBe(false);
  });

  it('renders the template once without re-substituting answer text', () => {
    const { user } = perceptionPrompt(pkgFor('Acme says {prompt} here.'), policy.perception);
    expect(user).toContain('Question asked: best tools?');
    expect(user).toContain('Acme says {prompt} here.');
  });
});

describe('perception validation', () => {
  const pkg = pkgFor('Acme is great value.  Rival   support is slow.');

  it('keeps verified quotes, drops invented ones, unknown entities and maps stray themes', () => {
    const result = validateOutput(
      pkg,
      {
        entities: [
          {
            entity_id: 'brand:acme',
            label: 'positive',
            confidence: 0.9,
            aspects: [
              { theme: 'value', polarity: 'positive', quote: 'great value' },
              { theme: 'pricing', polarity: 'negative', quote: 'Acme is overpriced' },
            ],
          },
          {
            entity_id: 'competitor:rival',
            label: 'negative',
            confidence: 0.4,
            aspects: [{ theme: 'helpdesk', polarity: 'negative', quote: 'Rival support is slow' }],
          },
          { entity_id: 'competitor:ghost', label: 'negative', confidence: 1, aspects: [] },
        ],
      },
      policy.perception,
    );
    expect(result.drops).toEqual({ quote_not_found: 1, theme_other: 1, unknown_entity: 1 });
    expect(result.entities.map((e) => [e.entity_id, e.label, e.low_confidence, e.aspects])).toEqual(
      [
        [
          'brand:acme',
          'positive',
          false,
          [{ theme: 'value', polarity: 'positive', quote: 'great value', start: 8, end: 19 }],
        ],
        [
          'competitor:rival',
          'negative',
          true,
          [
            {
              theme: 'other',
              polarity: 'negative',
              quote: 'Rival   support is slow',
              start: 22,
              end: 45,
            },
          ],
        ],
      ],
    );
  });

  it('gives an omitted entity a not-assessable row and counts it', () => {
    const result = validateOutput(pkg, { entities: [] }, policy.perception);
    expect(result.drops).toEqual({ missing_entity: 2 });
    expect(result.entities.map((e) => [e.entity_id, e.label, e.confidence])).toEqual([
      ['brand:acme', 'not_assessable', null],
      ['competitor:rival', 'not_assessable', null],
    ]);
  });
});

const classified = (label: 'positive' | 'neutral' | 'negative' | 'mixed'): Mention => ({
  entity: 'Acme',
  isBrand: true,
  status: { kind: 'classified', label },
  aspects: [],
});

describe('perception metrics', () => {
  it('nets positive against negative over every classified label, mixed in the denominator only', () => {
    expect(
      score([
        classified('positive'),
        classified('positive'),
        classified('negative'),
        classified('mixed'),
      ]),
    ).toEqual({
      positive: 2,
      neutral: 0,
      negative: 1,
      mixed: 1,
      classified: 4,
      positive_share: 0.5,
      negative_share: 0.25,
      net_sentiment: 25,
    });
  });

  it('excludes low-confidence and pending mentions from the score but counts them', () => {
    const mentions: Mention[] = [
      classified('negative'),
      { ...classified('positive'), status: { kind: 'low_confidence' } },
      { ...classified('positive'), status: { kind: 'pending' } },
      { ...classified('positive'), status: { kind: 'unavailable', reason: 'platform_cap' } },
      { ...classified('positive'), status: { kind: 'not_assessable' } },
    ];
    expect(score(mentions).net_sentiment).toBe(-100);
    expect(coverage(mentions)).toEqual({
      mentions: 5,
      classified: 1,
      pending: 1,
      not_assessable: 1,
      low_confidence: 1,
      unavailable: [{ reason: 'platform_cap', count: 1 }],
    });
  });

  it('distinguishes pending, unavailable and no mentions, never a zero', () => {
    const pending = coverage([{ ...classified('positive'), status: { kind: 'pending' } }]);
    const capped = coverage([
      {
        ...classified('positive'),
        status: { kind: 'unavailable', reason: 'model_not_configured' },
      },
    ]);
    expect([readState(pending), readState(capped), readState(coverage([]))]).toEqual([
      { state: 'pending', reason: null },
      { state: 'unavailable', reason: 'model_not_configured' },
      { state: 'no_mentions', reason: null },
    ]);
    expect(score([]).net_sentiment).toBeNull();
  });

  it('reads each persisted outcome into a mention status', () => {
    const entity = { label: 'positive' as const, low_confidence: false };
    expect([
      mentionStatus(undefined, undefined),
      mentionStatus({ outcome: 'classified' }, entity),
      mentionStatus({ outcome: 'classified' }, { ...entity, low_confidence: true }),
      mentionStatus({ outcome: 'classified' }, undefined),
      mentionStatus({ outcome: 'unavailable', outcome_reason: 'platform_cap' }, undefined),
      mentionStatus({ outcome: 'invalid_output' }, undefined),
    ]).toEqual([
      { kind: 'pending' },
      { kind: 'classified', label: 'positive' },
      { kind: 'low_confidence' },
      { kind: 'unavailable', reason: 'entity_limit' },
      { kind: 'unavailable', reason: 'platform_cap' },
      { kind: 'unavailable', reason: 'invalid_output' },
    ]);
  });

  it('marks a trend point after a version change as not comparable and links quotes to the run', () => {
    const answer = (
      auditId: string,
      at: string,
      template: string,
      label: 'positive' | 'negative',
    ): PerceptionAnswer => ({
      auditId,
      executionId: `${auditId}-e`,
      observedAt: at,
      logicalEngine: 'chatgpt',
      prompt: 'best tools?',
      topic: 'tools',
      versions: { extractor: 'x1', template, metrics: 'm1' },
      mentions: [
        {
          ...classified(label),
          aspects: [
            { theme: 'support', polarity: label, quote: `support ${label}`, start: 0, end: 1 },
          ],
        },
      ],
      brandRecommendation: label === 'positive' ? 'recommended' : 'mentioned',
      citations: [{ domain: 'reviews.example', url: 'https://reviews.example/a' }],
    });
    const summary = perceptionSummary(
      [
        answer('run-a', '2026-10-01T00:00:00Z', 't1', 'positive'),
        answer('run-b', '2026-10-02T00:00:00Z', 't1', 'negative'),
        answer('run-c', '2026-10-03T00:00:00Z', 't2', 'negative'),
      ],
      { max_quotes_per_theme: 3, max_negative_quotes: 10, max_drivers: 10 },
    );
    expect(
      summary.trend.map((point) => [point.audit_id, point.score.net_sentiment, point.comparable]),
    ).toEqual([
      ['run-a', 100, true],
      ['run-b', -100, true],
      ['run-c', -100, false],
    ]);
    expect(summary.themes).toEqual([
      expect.objectContaining({ theme: 'support', positive: 1, negative: 2 }),
    ]);
    expect(summary.negative_quotes.map((q) => [q.text, q.run_id, q.execution_id])).toEqual([
      ['support negative', 'run-c', 'run-c-e'],
      ['support negative', 'run-b', 'run-b-e'],
    ]);
    expect(summary.drivers).toEqual([
      { domain: 'reviews.example', answers: 2, example_url: 'https://reviews.example/a' },
    ]);
    expect(summary.recommended).toMatchObject({ mentioned: 3, recommended: 1, rate: 1 / 3 });
    expect(summary.state).toBe('value');
  });
});

describe('perception calibration fixtures', () => {
  it('find every hand-labelled business in its answer, in every language', async () => {
    const { default: fixtures } = await import('./fixtures/perception/answers.json', {
      with: { type: 'json' },
    });
    const missing = fixtures.flatMap((fixture) => {
      const named = entityPassages({
        answer: fixture.answer,
        languageCode: fixture.language,
        config: scoringConfig({
          brand_name: fixture.brand_name,
          competitors: fixture.competitors.map((name) => ({ name, domains: [] })),
        }),
        policy: limits,
      }).map((entity) => entity.name);
      return Object.keys(fixture.labels)
        .filter((name) => !named.includes(name))
        .map((name) => `${fixture.name}:${name}`);
    });
    expect(missing).toEqual([]);
  });
});
