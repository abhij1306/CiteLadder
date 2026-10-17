import { describe, expect, it } from 'vite-plus/test';

import { discoveryResults } from './onboarding-stages';

describe('discoveryResults', () => {
  it('renders the discovered website without its scheme or trailing slash', () => {
    const discovery = {
      input_data: { website_url: 'https://acme-outdoor.example/' },
      competitors: [{ name: 'Example competitor' }],
    };

    expect(discoveryResults(discovery as never)).toEqual([
      'acme-outdoor.example',
      'Example competitor',
    ]);
  });
});
