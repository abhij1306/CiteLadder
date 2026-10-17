import { describe, expect, it } from 'vitest';
import { projectCost, rateCard, type RateCard } from '../src/audits/costs.ts';
import { providerPolicy } from '../src/providers/config.ts';
const pricing: RateCard = {
  uncached_input_microusd_per_million: 3_000_000,
  cached_input_microusd_per_million: 1_000_000,
  output_microusd_per_million: 15_000_000,
  reasoning_microusd_per_million: null,
  search_fee_microusd: 10_000,
  currency: 'USD',
  effective_date: '2026-09-30',
  pricing_version: 'test',
};
describe('audit execution costing', () => {
  it('keeps reported charges separate from computed costs and sums disjoint lines', () => {
    expect(
      projectCost(
        {
          uncached_input_tokens: 10,
          cached_input_tokens: 20,
          output_tokens: 7,
          search_requests: 2,
          provider_cost_microusd: 50000,
        },
        pricing,
      ),
    ).toMatchObject({
      projection_status: 'complete',
      uncached_input_cost_microusd: 30,
      cached_input_cost_microusd: 20,
      output_cost_microusd: 105,
      search_cost_microusd: 20000,
      projected_total_cost_microusd: 20155,
      provider_reported_cost_microusd: 50000,
    });
  });
  it('refuses a complete total when an applicable reasoning rate is unknown', () => {
    expect(projectCost({ output_tokens: 7, reasoning_tokens: 2 }, pricing)).toMatchObject({
      projection_status: 'partial',
      output_cost_microusd: 105,
      reasoning_cost_microusd: null,
      projected_total_cost_microusd: null,
    });
  });
  it('distinguishes no usage, malformed usage, and a reported zero', () => {
    expect(projectCost({}, pricing)).toMatchObject({
      projection_status: 'unknown',
      total_tokens: null,
    });
    expect(projectCost({ output_tokens: true }, pricing).output_tokens).toBeNull();
    expect(projectCost({ output_tokens: 0 }, pricing)).toMatchObject({
      projection_status: 'complete',
      output_tokens: 0,
      output_cost_microusd: 0,
      projected_total_cost_microusd: 0,
    });
  });
  it('preserves a paid flat-fee observation even when token pricing is unavailable', () => {
    const route = providerPolicy.routes.google_ai_overview;
    const card = rateCard(route);
    if (!card) throw new Error('No pricing version');
    expect(projectCost({ provider_cost_microusd: 1200 }, card)).toMatchObject({
      projection_status: 'partial',
      provider_reported_cost_microusd: 1200,
      projected_total_cost_microusd: null,
      output_tokens: null,
    });
  });
  it('prices only known catalog versions and models', () => {
    const route = providerPolicy.routes.claude;
    expect(rateCard(route, 'unknown-version')).toBeNull();
    expect(rateCard({ ...route, transport_model: 'historical-model' })).toMatchObject({
      output_microusd_per_million: null,
    });
  });
});
