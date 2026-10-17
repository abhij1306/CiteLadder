/** Deterministic ads metrics: applicability, presence, advertisers, creatives and prompts. */
import { describe, expect, it } from 'vitest';

import { adsSummary, type AdAnswer, type AdObservation } from '../src/visibility/ad-metrics.ts';

const OPTIONS = {
  adsEngine: 'chatgpt_search',
  engineFilter: null,
  metricsVersion: 'ads-metrics-test',
  advertisersLimit: 50,
};

const rivalAd: AdObservation = {
  rank_absolute: 1,
  advertiser_name: 'Rival',
  advertiser_domain: 'rival.example',
  ownership: 'competitor',
  title: 'Rival Runner',
  snippet: 'Free returns.',
  landing_url_canonical: 'https://rival.example/runner',
};

function answer(input: Partial<AdAnswer>): AdAnswer {
  return {
    auditId: 'run-1',
    observedAt: '2026-10-01T00:00:00Z',
    engine: 'chatgpt_search',
    prompt: 'best running shoes',
    topic: 'Shoes',
    adsParserVersion: 'chatgpt-ads-test',
    brandMentioned: false,
    ads: [],
    ...input,
  };
}

describe('ads metrics', () => {
  it('keeps not applicable, unavailable and observed zero apart', () => {
    const summary = adsSummary(
      [
        answer({ ads: [] }),
        answer({ engine: 'chatgpt_search', adsParserVersion: null }),
        answer({ engine: 'claude', adsParserVersion: null }),
      ],
      OPTIONS,
    );
    expect(summary.state).toBe('value');
    expect(summary.presence).toEqual({ answers: 1, answers_with_ads: 0, rate: 0 });
    expect(summary.engines).toEqual([
      {
        engine: 'chatgpt_search',
        applicability: 'applicable',
        answers: 2,
        presence: { answers: 1, answers_with_ads: 0, rate: 0 },
      },
      { engine: 'claude', applicability: 'not_applicable', answers: 1, presence: null },
    ]);
    expect(adsSummary([answer({ adsParserVersion: null })], OPTIONS)).toMatchObject({
      state: 'unavailable',
      presence: { answers: 0, answers_with_ads: 0, rate: null },
    });
    expect(adsSummary([answer({ engine: 'claude' })], OPTIONS).state).toBe('no_answers');
    expect(
      adsSummary([answer({ ads: [rivalAd] })], { ...OPTIONS, engineFilter: 'gemini' }).state,
    ).toBe('not_applicable');
  });

  it('rates presence over applicable answers and dedupes creatives across sightings', () => {
    const acmeAd: AdObservation = {
      ...rivalAd,
      rank_absolute: 2,
      advertiser_name: 'Acme',
      advertiser_domain: 'acme.example',
      ownership: 'owned',
      title: 'Acme Trail',
      landing_url_canonical: 'https://acme.example/trail',
    };
    const summary = adsSummary(
      [
        answer({ ads: [rivalAd, acmeAd], observedAt: '2026-10-01T00:00:00Z' }),
        answer({ ads: [rivalAd], observedAt: '2026-10-03T00:00:00Z', prompt: 'trail shoes' }),
        answer({ ads: [] }),
        answer({ ads: [], adsParserVersion: null }),
      ],
      OPTIONS,
    );
    expect(summary.presence).toEqual({ answers: 3, answers_with_ads: 2, rate: 2 / 3 });
    expect(summary.brand).toEqual({ appearances: 1, share: 1 / 3, best_rank: 2 });
    expect(summary.advertisers_seen).toBe(2);
    expect(summary.advertisers[0]).toEqual({
      name: 'Rival',
      domain: 'rival.example',
      ownership: 'competitor',
      appearances: 2,
      prompts: 2,
      share: 2 / 3,
      first_seen_at: '2026-10-01T00:00:00Z',
      last_seen_at: '2026-10-03T00:00:00Z',
    });
    expect(
      summary.creatives.map(({ title, appearances, prompts }) => ({ title, appearances, prompts })),
    ).toEqual([
      { title: 'Rival Runner', appearances: 2, prompts: 2 },
      { title: 'Acme Trail', appearances: 1, prompts: 1 },
    ]);
  });

  it('reports no brand share or rank when the brand never advertised, and counts ads beside organic mentions', () => {
    const summary = adsSummary(
      [
        answer({ ads: [rivalAd], brandMentioned: true }),
        answer({ ads: [rivalAd], brandMentioned: false }),
        answer({ ads: [rivalAd], brandMentioned: false }),
        answer({ ads: [], prompt: 'no ads here' }),
      ],
      OPTIONS,
    );
    expect(summary.brand).toEqual({ appearances: 0, share: null, best_rank: null });
    expect(summary.prompts).toEqual([
      {
        prompt: 'best running shoes',
        topic: 'Shoes',
        presence: { answers: 3, answers_with_ads: 3, rate: 1 },
        ads_seen: 3,
        top_advertiser: { name: 'Rival', domain: 'rival.example' },
        competitor_ad_answers: { brand_mentioned: 1, brand_not_mentioned: 2 },
      },
    ]);
  });
});
