import { describe, expect, it } from 'vitest';
import { aggregateRun, promptTrend, type AggregateExecution } from '../src/analysis/aggregate.ts';
import { scoringConfig, scoreExecution } from '../src/analysis/scoring.ts';
import { firstNamed, winCounts, winTally } from '../src/analysis/win-rate.ts';
const config = scoringConfig({
  brand_name: 'Acme',
  owned_domains: ['acme.example'],
  competitors: [{ name: 'Rival', aliases: ['Contender'] }],
});
function execution(
  answerText: string,
  citations: Record<string, unknown>[] = [],
  queryTextAvailable = true,
  queries: string[] = [],
  theme = 'Shoes',
): AggregateExecution {
  const score = scoreExecution({
    config,
    answerText,
    promptText: 'Which shoes?',
    promptNamesBrand: false,
    citations,
    searchEvents: queries.map((query) => ({ query })),
    searchUsed: true,
    queryTextAvailable,
  });
  return {
    prompt_index: 0,
    prompt_text_snapshot: 'Which shoes?',
    prompt_theme_snapshot: theme,
    cohort: 'core',
    logical_engine: 'chatgpt',
    score,
    citations,
    usage: {},
    first_named: firstNamed({
      brandName: config.brandName,
      brandOffset: score.brand_first_offset,
      competitorOffsets: score.competitor_first_offsets,
    }),
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
  it('prices each engine from its frozen route', () => {
    const routed = scoringConfig({
      brand_name: 'Acme',
      engine_routes: {
        claude: {
          logical_engine: 'claude',
          transport_provider: 'anthropic',
          transport_model: 'claude-sonnet-5-5',
          connection_id: null,
          base_url: 'https://api.anthropic.com',
        },
      },
    });
    const answer = (logical_engine: string, usage: Record<string, number>) => ({
      ...execution('Acme'),
      logical_engine,
      usage,
    });
    const claude = answer('claude', { uncached_input_tokens: 1_000_000, output_tokens: 100_000 });
    expect(aggregateRun([claude], routed).cost).toMatchObject({
      paid_list_token_estimate_usd: 3,
      grounding_cost_if_billable_usd: 0.01,
      cost_status: 'complete',
    });
    expect(
      aggregateRun([claude, answer('chatgpt', { output_tokens: 10 })], routed).cost,
    ).toMatchObject({
      paid_list_token_estimate_usd: null,
      cost_status: 'unknown',
    });
  });
  it('names first only the tracked roster, through aliases, and counts wins over answers naming one', () => {
    const answers = [
      execution('Zeta, then Acme, then Rival'),
      execution('Contender beats Acme'),
      execution('Zeta only', [], true, [], 'Boots'),
      execution('Nothing tracked', [], true, [], 'Boots'),
    ];
    expect(answers.map((answer) => answer.first_named)).toEqual([
      { kind: 'brand', name: 'Acme' },
      { kind: 'competitor', name: 'Rival' },
      { kind: 'none' },
      { kind: 'none' },
    ]);
    const metrics = aggregateRun(answers, config);
    expect(metrics.win_tally).toEqual({ answers: 2, first: { Acme: 1, Rival: 1 } });
    expect(winCounts(metrics.win_tally, 'Acme')).toEqual({
      win_count: 1,
      win_answers: 2,
      win_rate: 0.5,
    });
    expect(winCounts(aggregateRun(answers.slice(2), config).win_tally, 'Acme')).toEqual({
      win_count: 0,
      win_answers: 0,
      win_rate: null,
    });
    expect(winCounts(metrics.win_tally, 'Nobody')).toEqual({
      win_count: 0,
      win_answers: 2,
      win_rate: 0,
    });
    const shadow = winTally([{ kind: 'competitor', name: 'constructor' }], 'Acme');
    expect(shadow).toEqual({ answers: 1, first: { constructor: 1 } });
    expect(winCounts(metrics.win_tally, 'constructor')).toMatchObject({ win_count: 0 });
  });
  it('averages search queries over the answers that exposed them, unknown when none did', () => {
    const metrics = aggregateRun(
      [
        execution('Acme', [], true, ['best shoes', 'acme shoes review', 'shoe sale']),
        execution('Acme', [], true, ['best shoes']),
        execution('Acme', [], false),
      ],
      config,
    );
    expect(metrics.avg_queries_per_execution).toBe(2);
    expect(
      aggregateRun([execution('Acme', [], false)], config).avg_queries_per_execution,
    ).toBeNull();
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
