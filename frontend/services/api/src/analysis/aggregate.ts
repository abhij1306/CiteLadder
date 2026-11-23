import { policy } from '../config.ts';
import { numberRecord, strings } from '../db/json.ts';
import { scalarText, compareText } from '../text-order.ts';
import { groupBy } from '../lists.ts';
import { competitorPosition } from './position.ts';
import { citationDomain, type ScoringConfig } from './scoring.ts';
import { costStatus, rateCard, type RouteIdentity } from '../audits/costs.ts';
import { usageCount } from '../answer-engines/parse.ts';
import { round } from '../numbers.ts';
import type { FirstNamed } from '@citeladder/contracts/audits';
import { winTally } from './win-rate.ts';

export type AggregateExecution = {
  prompt_index: number;
  prompt_text_snapshot: string;
  prompt_theme_snapshot: string;
  cohort: string;
  logical_engine: string;
  score: Record<string, unknown>;
  citations: Record<string, unknown>[];
  usage: Record<string, unknown>;
  first_named: FirstNamed;
};
const rate = (numerator: number, denominator: number) =>
  denominator ? numerator / denominator : null;
const count = (scores: Record<string, unknown>[], key: string) =>
  scores.filter((s) => Boolean(s[key])).length;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const meanPosition = (values: (number | null)[]) => {
  const known = values.filter((n): n is number => n !== null);
  return known.length ? round(sum(known) / known.length, 2) : null;
};
function positions(scores: Record<string, unknown>[], config: ScoringConfig) {
  return Object.fromEntries([
    [
      config.brandName || 'Brand',
      meanPosition(
        scores.map((s) => (typeof s.brand_position === 'number' ? s.brand_position : null)),
      ),
    ],
    ...config.competitors.map((c) => [
      c.name,
      meanPosition(scores.map((s) => competitorPosition(s, c.name))),
    ]),
  ]);
}
const wins = (rows: AggregateExecution[], config: ScoringConfig) =>
  winTally(
    rows.map((row) => row.first_named),
    config.brandName || 'Brand',
  );
function shareOfVoice(scores: Record<string, unknown>[], config: ScoringConfig) {
  const entities = Object.fromEntries([
    [config.brandName || 'Brand', count(scores, 'brand_mentioned')],
    ...config.competitors.map((c) => [
      c.name,
      scores.filter((s) => strings(s.competitors_mentioned).includes(c.name)).length,
    ]),
  ]) as Record<string, number>;
  const total = sum(Object.values(entities));
  return {
    total_mentions: total,
    mention_counts: entities,
    share: Object.fromEntries(Object.entries(entities).map(([name, n]) => [name, rate(n, total)])),
  };
}
function citationAggregates(rows: AggregateExecution[]) {
  const domains = new Map<
    string,
    { annotations: number; executions: number; prompts: Set<number>; urls: Set<string> }
  >();
  for (const row of rows) {
    const seen = new Set<string>();
    for (const citation of row.citations) {
      const domain = citationDomain(citation);
      if (!domain) continue;
      const value = domains.get(domain) ?? {
        annotations: 0,
        executions: 0,
        prompts: new Set(),
        urls: new Set(),
      };
      value.annotations++;
      if (!seen.has(domain)) value.executions++;
      seen.add(domain);
      value.prompts.add(row.prompt_index);
      const url = scalarText(citation.resolved_url || citation.redirect_url || citation.url);
      if (url) value.urls.add(url);
      domains.set(domain, value);
    }
  }
  const top = [...domains].sort(([, a], [, b]) => b.annotations - a.annotations).slice(0, 25);
  const total = sum([...domains.values()].map((v) => v.annotations)),
    shown = sum(top.map(([, v]) => v.annotations));
  const annotations = Object.fromEntries(top.map(([d, v]) => [d, rate(v.annotations, total)]));
  if (total > shown) annotations.Other = rate(total - shown, total);
  const urls = new Set([...domains.values()].flatMap((v) => [...v.urls])).size;
  const prompts = new Set(rows.map((r) => r.prompt_index)).size;
  return {
    citation_share_by_domain: annotations,
    citation_annotation_share_by_domain: annotations,
    domain_execution_citation_rate: Object.fromEntries(
      top.map(([d, v]) => [d, rate(v.executions, rows.length)]),
    ),
    domain_unique_url_share: Object.fromEntries(top.map(([d, v]) => [d, rate(v.urls.size, urls)])),
    domain_prompt_coverage: Object.fromEntries(
      top.map(([d, v]) => [d, rate(v.prompts.size, prompts)]),
    ),
  };
}
function tokenLineEstimate(tokens: number, rate: number | null | undefined) {
  if (tokens === 0) return 0;
  return rate == null ? null : tokens * rate;
}
function searchFeeEstimate(grounded: number, fee: number | null | undefined) {
  if (grounded === 0) return 0;
  return fee == null ? null : (grounded * fee) / policy.costs.microusd_per_usd;
}
const priceLines = {
  uncached_input_tokens: 'uncached_input_microusd_per_million',
  cached_input_tokens: 'cached_input_microusd_per_million',
  output_tokens: 'output_microusd_per_million',
} as const;
const usageTotal = (rows: readonly AggregateExecution[], key: string) =>
  sum(rows.map((row) => usageCount(row.usage[key]) ?? 0));
const groundedCount = (rows: readonly AggregateExecution[]) =>
  rows.filter((row) => row.score.search_used).length;
const knownSum = (values: readonly (number | null)[]) =>
  values.reduce<number | null>((total, n) => (total === null || n === null ? null : total + n), 0);
function engineCost(rows: readonly AggregateExecution[], route: RouteIdentity | undefined) {
  const pricing = route ? rateCard(route) : null;
  return {
    tokens: knownSum(
      Object.entries(priceLines).map(([key, line]) =>
        tokenLineEstimate(usageTotal(rows, key), pricing?.[line]),
      ),
    ),
    search: searchFeeEstimate(groundedCount(rows), pricing?.search_fee_microusd),
  };
}
function tokenCost(rows: AggregateExecution[], config: ScoringConfig) {
  const totals = Object.fromEntries(
    [...Object.keys(priceLines), 'total_tokens'].map((key) => [key, usageTotal(rows, key)]),
  );
  const tokens = {
    input_tokens: totals.uncached_input_tokens! + totals.cached_input_tokens!,
    ...totals,
  };
  const engines = [...groupBy(rows, (row) => row.logical_engine)].map(([engine, group]) =>
    engineCost(group, config.engineRoutes[engine]),
  );
  const tokenMicrousd = knownSum(engines.map((engine) => engine.tokens));
  const tokenEstimate =
    tokenMicrousd === null
      ? null
      : tokenMicrousd / (policy.costs.tokens_per_million * policy.costs.microusd_per_usd);
  const searchEstimate = knownSum(engines.map((engine) => engine.search));
  const grounded = groundedCount(rows);
  const reported = rows
    .map((row) => usageCount(row.usage.provider_cost_microusd))
    .filter((n): n is number => n !== null);
  return {
    token_usage: tokens,
    cost: {
      currency: 'USD',
      grounded_requests: grounded,
      paid_list_token_estimate_usd: tokenEstimate === null ? null : round(tokenEstimate, 6),
      grounding_cost_if_billable_usd: searchEstimate === null ? null : round(searchEstimate, 6),
      cost_status: costStatus([tokenEstimate, searchEstimate]),
      pricing_version: policy.costs.pricing_version,
      provider_reported_cost_usd: reported.length
        ? round(sum(reported) / policy.costs.microusd_per_usd, 6)
        : null,
      provider_reported_cost_coverage: {
        reported_executions: reported.length,
        total_executions: rows.length,
      },
      free_allowance_applied: false,
      note: 'Unknown official price lines remain null and are never inferred as zero.',
    },
  };
}
function composite(group: AggregateExecution[], config: ScoringConfig) {
  const scores = group.map((r) => r.score),
    n = group.length;
  const mentioned = count(scores, 'brand_mentioned'),
    owned = count(scores, 'qualified_owned_cited'),
    ownedRaw = count(scores, 'owned_domain_cited');
  const competitors = sum(scores.map((s) => strings(s.competitors_mentioned).length));
  const visibility = n ? round(mentioned / n, 4) : 0,
    ownedRate = n ? round(owned / n, 4) : 0;
  const competitive =
    mentioned + competitors ? round(mentioned / (mentioned + competitors), 4) : null;
  const components: Record<string, number> = { visibility, owned_citations: ownedRate },
    rules = policy.audits.analysis;
  const weights: Record<string, number> = {
    visibility: rules.prompt_score_visibility_weight,
    owned_citations: rules.prompt_score_owned_citation_weight,
  };
  if (config.competitors.length && competitive !== null) {
    components.competitive_position = competitive;
    weights.competitive_position = rules.prompt_score_competitive_weight;
  }
  const total = sum(Object.values(weights));
  return {
    mentioned,
    ownedRaw,
    visibility,
    ownedRate,
    competitive,
    components,
    weights: Object.fromEntries(
      Object.entries(weights).map(([key, w]) => [key, round(w / total, 4)]),
    ),
    composite: round(
      (sum(Object.entries(weights).map(([key, w]) => components[key]! * w)) / total) * 100,
      2,
    ),
  };
}
function promptMetrics(rows: AggregateExecution[], config: ScoringConfig) {
  const grouped = groupBy(rows, (row) => row.prompt_index);
  return [...grouped]
    .map(([index, group]) => {
      const values = composite(group, config),
        n = group.length;
      const engines = [...new Set(group.map((r) => r.logical_engine).filter(Boolean))].sort(
        compareText,
      );
      const engineScores = Object.fromEntries(
        engines.map((e) => [
          e,
          composite(
            group.filter((r) => r.logical_engine === e),
            config,
          ).composite,
        ]),
      );
      const points = Object.values(engineScores);
      return {
        prompt_index: index,
        prompt_text: group[0].prompt_text_snapshot,
        theme: group[0].prompt_theme_snapshot,
        repetitions: n,
        brand_mentioned_count: values.mentioned,
        owned_cited_count: values.ownedRaw,
        mention_stability: Math.max(values.mentioned, n - values.mentioned) / n,
        owned_stability: Math.max(values.ownedRaw, n - values.ownedRaw) / n,
        visibility_rate: values.visibility,
        competitive_share: config.competitors.length ? values.competitive : null,
        qualified_owned_citation_rate: values.ownedRate,
        composite_score: values.composite,
        score_components: values.components,
        score_weights: values.weights,
        per_engine_scores: engineScores,
        cross_engine_consistency: points.length
          ? round(1 - (Math.max(...points) - Math.min(...points)) / 100, 4)
          : 0,
        avg_position: meanPosition(
          group.map((r) =>
            typeof r.score.brand_position === 'number' ? r.score.brand_position : null,
          ),
        ),
      };
    })
    .sort((a, b) => b.composite_score - a.composite_score || a.prompt_index - b.prompt_index);
}
export type AnswerCounts = { answers: number; mentioned: number; cited: number };

export function answerCounts(
  answers: readonly { brand_mentioned?: unknown; owned_domain_cited?: unknown }[],
): AnswerCounts {
  return {
    answers: answers.length,
    mentioned: answers.filter((answer) => Boolean(answer.brand_mentioned)).length,
    cited: answers.filter((answer) => Boolean(answer.owned_domain_cited)).length,
  };
}

export function answerRates({
  answers,
  mentioned,
  cited,
}: {
  answers: number;
  mentioned: number | null;
  cited: number | null;
}) {
  return {
    brand_mention_rate: mentioned === null ? null : rate(mentioned, answers),
    owned_citation_rate: cited === null ? null : rate(cited, answers),
  };
}

export function aggregateRun(rows: AggregateExecution[], config: ScoringConfig) {
  const scores = rows.map((row) => row.score),
    total = rows.length;
  const counted = answerCounts(scores);
  const rates = answerRates(counted);
  const mention = counted.mentioned,
    owned = counted.cited;
  const queryScores = scores.filter(
    (s) => s.prompt_class === 'non_branded' && s.search_query_text_available === true,
  );
  const queried = scores.filter((s) => s.search_query_text_available === true);
  const queryCoverage = queried.length;
  const citations = sum(scores.map((s) => Number(s.citation_count) || 0)),
    ownedCitations = sum(scores.map((s) => Number(s.owned_citation_count) || 0));
  const classes: Record<string, number> = {};
  for (const s of scores) {
    const key = scalarText(s.prompt_class) || 'unknown';
    classes[key] = (classes[key] ?? 0) + 1;
  }
  return {
    total_completed: total,
    brand_mention_count: mention,
    owned_citation_response_count: owned,
    observation_state: total ? 'measured' : 'no_observations',
    brand_mention_rate: rates.brand_mention_rate,
    owned_citation_rate: rates.owned_citation_rate,
    mention_to_owned_citation_conversion: rate(
      scores.filter((s) => s.brand_mentioned && s.owned_domain_cited).length,
      mention,
    ),
    brand_fanout_injection_rate: rate(
      count(queryScores, 'brand_injected_in_search'),
      queryScores.length,
    ),
    search_query_text_coverage_rate: rate(queryCoverage, total),
    competitor_fanout_injection_rate: rate(
      queryScores.filter((s) => strings(s.competitors_injected_in_search).length).length,
      queryScores.length,
    ),
    search_use_rate: rate(count(scores, 'search_used'), total),
    avg_queries_per_execution: queryCoverage
      ? round(sum(queried.map((s) => Number(s.search_query_count) || 0)) / queryCoverage, 2)
      : null,
    unintended_domain_citation_rate: rate(count(scores, 'unintended_domain_cited'), total),
    ...citationAggregates(rows),
    competitor_mention_rate: Object.fromEntries(
      config.competitors.map((c) => [
        c.name,
        rate(scores.filter((s) => strings(s.competitors_mentioned).includes(c.name)).length, total),
      ]),
    ),
    competitor_citation_rate: Object.fromEntries(
      config.competitors.map((c) => [
        c.name,
        rate(
          scores.filter((s) => strings(s.competitor_domains_cited).includes(c.name)).length,
          total,
        ),
      ]),
    ),
    share_of_voice: shareOfVoice(scores, config),
    average_positions: positions(scores, config),
    win_tally: wins(rows, config),
    citation_totals: {
      citations,
      owned_citations: ownedCitations,
      owned_share: rate(ownedCitations, citations),
    },
    prompt_class_counts: classes,
    per_prompt: promptMetrics(rows, config),
    ...tokenCost(rows, config),
    avg_position: meanPosition(
      scores.map((s) => (typeof s.brand_position === 'number' ? s.brand_position : null)),
    ),
  };
}
export type Aggregate = ReturnType<typeof aggregateRun>;

export function promptTrend(
  row: ReturnType<typeof promptMetrics>[number],
  previous: {
    composite_score: number;
    immediate_delta: number | null;
    per_engine_scores: unknown;
  }[],
  repetitions: number,
  engineCount: number,
) {
  const rules = policy.audits.analysis,
    score = row.composite_score,
    priorScore = previous[0]?.composite_score ?? null;
  const delta = priorScore === null ? null : round(score - priorScore, 2),
    priorEngines = numberRecord(previous[0]?.per_engine_scores);
  const shared = Object.keys(row.per_engine_scores).filter((e) => Object.hasOwn(priorEngines, e));
  const declining = shared.filter(
    (e) => row.per_engine_scores[e]! - priorEngines[e]! <= -rules.prompt_decline_materiality_points,
  ).length;
  const agreement = shared.length ? round(declining / shared.length, 4) : 0;
  const deltas = [delta, ...previous.slice(0, 3).map((p) => p.immediate_delta)].filter(
    (n): n is number => n !== null,
  );
  const coverage =
    repetitions * engineCount ? round(row.repetitions / (repetitions * engineCount), 4) : 0;
  return {
    composite_score: score,
    previous_score: priorScore,
    immediate_delta: delta,
    rolling_four: [score, ...previous.slice(0, 3).map((p) => p.composite_score)],
    per_engine_scores: row.per_engine_scores,
    engine_agreement: agreement,
    repetition_agreement: row.mention_stability,
    evidence_coverage: coverage,
    trend_confidence: round((agreement + row.mention_stability + coverage) / 3, 4),
    decline_confirmed:
      delta !== null &&
      delta <= -rules.prompt_decline_materiality_points &&
      deltas.length >= rules.prompt_decline_window_movements &&
      deltas.filter((d) => d <= -rules.prompt_decline_materiality_points).length >=
        rules.prompt_decline_required_movements &&
      declining >= rules.prompt_decline_min_engines &&
      (repetitions <= 1 || row.mention_stability >= rules.prompt_decline_repetition_agreement),
  };
}
