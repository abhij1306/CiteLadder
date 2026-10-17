import { describe, expect, it } from 'vitest';
import { aggregateRun, promptTrend, type AggregateExecution } from '../src/analysis/aggregate.ts';
import { scoringConfig, scoreExecution } from '../src/analysis/scoring.ts';
const config = scoringConfig({
  brand_name: 'Acme',
  owned_domains: ['acme.example'],
  competitors: [{ name: 'Rival' }],
});
function execution(
  answerText: string,
  citations: Record<string, unknown>[] = [],
  queryTextAvailable = true,
): AggregateExecution {
  return {
    prompt_index: 0,
    prompt_text_snapshot: 'Which shoes?',
    prompt_theme_snapshot: 'Shoes',
    cohort: 'core',
    logical_engine: 'chatgpt',
    score: scoreExecution({
      config,
      answerText,
      promptText: 'Which shoes?',
      citations,
      searchEvents: [],
      searchUsed: true,
      queryTextAvailable,
    }),
    citations,
    usage: {},
  };
}
describe('versioned audit aggregates', () => {
  it('keeps annotation counts, response rates, voice and rank on their distinct denominators', () => {
    const metrics = aggregateRun(
      [
        execution('Rival then Acme', [
          { url: 'https://acme.example/a', title: 'Acme' },
          { url: 'https://acme.example/b', title: 'Acme' },
        ]),
        execution('Rival only', [{ url: 'https://publisher.example/a' }], false),
        execution('Nothing tracked'),
      ],
      config,
    );
    expect(metrics).toMatchObject({
      total_completed: 3,
      brand_mention_rate: 1 / 3,
      owned_citation_rate: 1 / 3,
      mention_to_owned_citation_conversion: 1,
      search_query_text_coverage_rate: 2 / 3,
      share_of_voice: {
        mention_counts: { Acme: 1, Rival: 2 },
        share: { Acme: 1 / 3, Rival: 2 / 3 },
      },
      average_positions: { Acme: 2, Rival: 1 },
      citation_totals: { citations: 3, owned_citations: 2, owned_share: 2 / 3 },
      domain_execution_citation_rate: { 'acme.example': 1 / 3 },
      citation_share_by_domain: { 'acme.example': 2 / 3 },
    });
    expect(metrics.per_prompt[0]).toMatchObject({
      visibility_rate: 0.3333,
      competitive_share: 0.3333,
      qualified_owned_citation_rate: 0.3333,
      composite_score: 33.33,
      mention_stability: 2 / 3,
    });
    expect(aggregateRun([], config)).toMatchObject({
      observation_state: 'no_observations',
      brand_mention_rate: null,
      avg_position: null,
      cost: { provider_reported_cost_usd: null },
    });
  });
  it('treats nobody named as not applicable for the competitive component, not a zero share', () => {
    const silent = aggregateRun([execution('Nothing tracked')], config).per_prompt[0]!;
    expect(silent.competitive_share).toBeNull();
    expect(Object.keys(silent.score_components)).not.toContain('competitive_position');
    expect(Object.keys(silent.score_weights)).not.toContain('competitive_position');
    expect(Object.values(silent.score_weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3);
    const lost = aggregateRun([execution('Rival only')], config).per_prompt[0]!;
    expect(lost.competitive_share).toBe(0);
    expect(lost.score_components).toHaveProperty('competitive_position', 0);
  });
  it('confirms decline only after enough movements, shared engines and repetition agreement', () => {
    const base = aggregateRun([execution('Nothing tracked')], config).per_prompt[0]!;
    const row = {
      ...base,
      composite_score: 20,
      per_engine_scores: { chatgpt: 20, gemini: 20 },
      repetitions: 6,
      mention_stability: 1,
    };
    const previous = [30, 40, 50, 60].map((score) => ({
      composite_score: score,
      immediate_delta: -10,
      per_engine_scores: { chatgpt: score, gemini: score },
    }));
    expect(promptTrend(row, previous, 3, 2)).toMatchObject({
      decline_confirmed: true,
      evidence_coverage: 1,
      immediate_delta: -10,
      rolling_four: [20, 30, 40, 50],
    });
    expect(promptTrend(row, previous.slice(0, 2), 3, 2).decline_confirmed).toBe(false);
    expect(promptTrend({ ...row, mention_stability: 0.5 }, previous, 3, 2).decline_confirmed).toBe(
      false,
    );
    expect(
      promptTrend(
        row,
        previous.map((p) => ({ ...p, per_engine_scores: { chatgpt: p.composite_score } })),
        3,
        2,
      ).decline_confirmed,
    ).toBe(false);
  });
});
