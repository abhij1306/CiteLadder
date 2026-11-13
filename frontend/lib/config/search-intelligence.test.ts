import { describe, expect, it } from 'vite-plus/test';

import { searchMarketLabel, searchMarketOptions } from './search-intelligence';

const MARKETS = [
  { country_code: 'US', location_code: 2840 },
  { country_code: 'AU', location_code: 2036 },
];

describe('Search Intelligence market label', () => {
  it('names an offered market and preserves unknown states', () => {
    expect(searchMarketLabel(2840, MARKETS)).toBe('United States');
    expect(searchMarketLabel(null, MARKETS)).toBe('Market not set');
    expect(searchMarketLabel(9999, MARKETS)).toBe('Location code 9999');
  });

  it('offers each market the server sent, by name', () => {
    expect(searchMarketOptions(MARKETS)).toEqual([
      { value: '2840', label: 'United States' },
      { value: '2036', label: 'Australia' },
    ]);
  });
});
