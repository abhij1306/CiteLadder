import { describe, expect, it } from 'vite-plus/test';

import { searchMarketLabel } from './search-intelligence';

describe('Search Intelligence market label', () => {
  it('shows a country for supported locations and preserves unknown states', () => {
    expect(searchMarketLabel(2840)).toBe('United States');
    expect(searchMarketLabel(null)).toBe('Market not set');
    expect(searchMarketLabel(9999)).toBe('Location code 9999');
  });
});
