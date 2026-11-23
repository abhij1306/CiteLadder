import { afterEach, describe, expect, it } from 'vite-plus/test';

import { openDomainUrls } from './visibility-sources';

afterEach(() => window.history.replaceState(null, '', '/'));

describe('opening a domain', () => {
  it('shows its URLs on the URLs tab and drops the previous table position and filters', () => {
    window.history.replaceState(
      null,
      '',
      '/visibility?tab=domains&engine=claude&source_type=ugc&source_offset=50&source_url=https%3A%2F%2Fold.example%2Fa',
    );

    openDomainUrls('shopback.com.au');

    expect(Object.fromEntries(new URLSearchParams(window.location.search))).toEqual({
      tab: 'urls',
      engine: 'claude',
      source_pick: 'shopback.com.au',
    });
  });
});
