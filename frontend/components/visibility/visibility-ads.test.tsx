import { screen, within } from '@testing-library/react';
import { renderWithProviders as render } from '@/test/render';
import { describe, expect, it } from 'vite-plus/test';
import type { VisibilityAdsResponse } from '@citeladder/contracts/visibility-ads';
import { mergedAdPages } from '@/lib/visibility/use-ads';
import { AdsView } from './visibility-ads';

const RUN = '11111111-1111-4111-8111-111111111111';
const presence = { answers: 4, answers_with_ads: 3, rate: 0.75 };

function response(overrides: Partial<VisibilityAdsResponse> = {}): VisibilityAdsResponse {
  return {
    state: 'value',
    source_audit_ids: [RUN],
    parser_versions: ['chatgpt-ads-1'],
    metrics_version: 'ads-metrics-1',
    presence,
    engines: [
      { engine: 'chatgpt_search', applicability: 'applicable', answers: 4, presence },
      { engine: 'claude', applicability: 'not_applicable', answers: 4, presence: null },
    ],
    brand: { appearances: 0, share: null, best_rank: null },
    advertisers_seen: 1,
    advertisers: [
      {
        name: 'Rival',
        domain: 'rival.example',
        ownership: 'competitor',
        appearances: 3,
        prompts: 2,
        share: 1,
        first_seen_at: '2026-10-01T00:00:00Z',
        last_seen_at: '2026-10-03T00:00:00Z',
      },
    ],
    creatives: {
      items: [
        {
          advertiser_name: 'Rival',
          advertiser_domain: 'rival.example',
          ownership: 'competitor',
          title: 'Rival Runner 3',
          snippet: 'Free returns on every pair.',
          landing_url: 'https://shop.rival.example/runner-3',
          appearances: 3,
          prompts: 2,
          first_seen_at: '2026-10-01T00:00:00Z',
          last_seen_at: '2026-10-03T00:00:00Z',
        },
      ],
      total: 1,
      next_cursor: null,
    },
    prompts: [
      {
        prompt: 'best running shoes',
        topic: 'Shoes',
        presence,
        ads_seen: 3,
        top_advertiser: { name: 'Rival', domain: 'rival.example' },
        competitor_ad_answers: { brand_mentioned: 1, brand_not_mentioned: 2 },
      },
    ],
    topics: [],
    runs: [],
    ...overrides,
  };
}

describe('Ads view', () => {
  it('shows ad presence over ChatGPT Search answers and names engines without ads', () => {
    render(<AdsView data={response()} />);
    const tiles = within(screen.getByLabelText('Ads in ChatGPT answers'));
    expect(tiles.getByText('75%')).toBeVisible();
    expect(tiles.getByText('3 of 4 ChatGPT Search answers showed an ad')).toBeVisible();
    expect(tiles.getByText('No ads of yours were seen.')).toBeVisible();
    expect(screen.getByText('Claude API: Not applicable')).toBeVisible();
    expect(screen.getByText('1 of 3 answers')).toBeVisible();
    expect(screen.getByText('Rival Runner 3')).toBeVisible();
    expect(screen.getByText('Rival · shop.rival.example/runner-3 · 3 appearances')).toBeVisible();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it.each([
    ['not_applicable', 'Not applicable'],
    ['unavailable', 'Ads unavailable'],
    ['no_answers', 'No ChatGPT Search answers'],
  ] as const)('renders the %s state instead of a zero', (state, heading) => {
    render(<AdsView data={response({ state })} />);
    expect(screen.getByRole('heading', { name: heading })).toBeVisible();
    expect(screen.queryByLabelText('Ads in ChatGPT answers')).toBeNull();
  });

  it('keeps the first page summary and appends later creative pages, offering more only while a cursor remains', () => {
    const first = response({
      creatives: { ...response().creatives, total: 2, next_cursor: 'next' },
    });
    const second = response({
      advertisers_seen: 99,
      creatives: {
        items: response().creatives.items.map((item) => ({ ...item, title: 'Rival Trail 2' })),
        total: 2,
        next_cursor: null,
      },
    });
    const merged = mergedAdPages([first, second]);
    expect(merged.advertisers_seen).toBe(1);
    expect(merged.creatives.items.map((item) => item.title)).toEqual([
      'Rival Runner 3',
      'Rival Trail 2',
    ]);
    expect(merged.creatives.next_cursor).toBeNull();
    const { rerender } = render(<AdsView data={first} onShowMore={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Show more creatives' })).toBeEnabled();
    rerender(<AdsView data={merged} />);
    expect(screen.queryByRole('button', { name: 'Show more creatives' })).toBeNull();
  });
});
