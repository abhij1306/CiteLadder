import { expect, it } from 'vite-plus/test';
import {
  estimateUsd,
  evidenceFields,
  reportedCost,
  runEstimate,
} from './search-intelligence-format';

it('keeps a calendar date on its own day west of UTC, and zones a timestamp', () => {
  const fields = evidenceFields(
    { first_seen: '2026-01-01', last_seen: '2026-01-01T03:00:00Z' },
    {},
    'America/Los_Angeles',
  );
  expect(fields.map(({ value }) => value)).toEqual(['Jan 1, 2026', 'Dec 31, 2025']);
});

const byok = {
  confirmed_at: 'confirmed',
  estimated_cost_usd: '0.024468',
  provider_reported_cost_usd: null,
};

it('distinguishes unconfirmed, unknown, zero and fractional provider costs', () => {
  expect(reportedCost({ ...byok, confirmed_at: null, provider_reported_cost_usd: '1' })).toBe(
    'Not charged',
  );
  expect(reportedCost(byok)).toBe('Unresolved');
  expect(reportedCost({ ...byok, provider_reported_cost_usd: '0' })).toBe('$0');
  expect(reportedCost({ ...byok, provider_reported_cost_usd: '0.024468' })).toBe('$0.024468');
  expect(runEstimate(byok)).toBe('$0.0245');
  expect(estimateUsd('1.00000000')).toBe('1.0000');
});
