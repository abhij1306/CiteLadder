import { describe, expect, it } from 'vite-plus/test';

import { discoveryResults, warningCallouts } from './onboarding-stages';

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

describe('warningCallouts', () => {
  it('shows a message shared by several warning codes once, keeping its rerun action', () => {
    const callouts = warningCallouts(
      ['external_research_unavailable', 'research_degraded', 'competitors_not_found'],
      'research_degraded',
    );

    expect(callouts).toEqual([
      {
        message: 'We used the website details we could confirm. Review them before continuing.',
        rerunnable: true,
      },
      {
        message: 'No competitors were confirmed. You can continue with none or add them yourself.',
        rerunnable: false,
      },
    ]);
  });
});
