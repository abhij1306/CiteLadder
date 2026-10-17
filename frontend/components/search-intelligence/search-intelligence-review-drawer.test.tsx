import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import type {
  SearchIntelligenceReadiness,
  SearchIntelligenceRun,
} from '@/lib/api/search-intelligence';

import { SearchIntelligenceReviewDrawer } from './search-intelligence-review-drawer';

const RUN_ID = 'a5df36ea-cb35-40f9-a7a9-a50ff7309cf1';
const readiness: SearchIntelligenceReadiness = {
  connected: true,
  connection_id: '72dbc77c-676f-4bf7-8c29-16f163cb09f5',
  owned_targets: [
    {
      identity: 'primary',
      label: 'Example',
      registrable_domain: 'example.com',
      hostname: 'www.example.com',
      origin: 'https://www.example.com',
      source_kind: 'owned',
    },
  ],
  competitors: [],
  preferences: {
    owned_target_id: 'primary',
    competitor_ids: [],
    location_code: 2840,
    language_code: 'en',
    reuse_recent: true,
    depths: {},
  },
  latest_run: null,
  datasets: [],
};
const reviewedRun: SearchIntelligenceRun = {
  id: RUN_ID,
  status: 'reviewed',
  action: 'analysis',
  pricing_version: 'dataforseo-live-2026-09-20',
  estimated_cost_usd: '0.14412000',
  provider_reported_cost_usd: null,
  planned_calls: 2,
  completed_calls: 0,
  planned_rows: 1001,
  received_rows: 0,
  uncertain_calls: 0,
  error_code: '',
  error_detail: '',
  expires_at: '2026-09-20T11:00:00Z',
  confirmed_at: null,
  cancelled_at: null,
  completed_at: null,
  frozen_scope: {},
  call_plan: [
    {
      request_key: 'ranking:1',
      dataset_kind: 'ranking_keywords',
      estimated_cost_usd: '0.132',
    },
    {
      request_key: 'ranking:2',
      dataset_kind: 'ranking_keywords',
      estimated_cost_usd: '0.01212',
    },
  ],
  reused_datasets: [],
  created_at: '2026-09-20T10:00:00Z',
};

describe('SearchIntelligenceReviewDrawer', () => {
  it('requires a positive location and a seed for keyword suggestions', async () => {
    render(
      <SearchIntelligenceReviewDrawer
        open
        action="analysis"
        readiness={{ ...readiness, preferences: { ...readiness.preferences, location_code: null } }}
        onOpenChange={vi.fn()}
        onReview={vi.fn()}
        onConfirm={vi.fn()}
        busy={false}
      />,
    );
    const submit = screen.getByRole('button', { name: 'Review cost' });
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByRole('combobox', { name: 'Market' }));
    await userEvent.click(screen.getByRole('option', { name: 'Australia' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Keyword suggestions' }));
    expect(submit).toBeDisabled();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Keyword suggestion seed' }),
      'analytics',
    );
    expect(submit).toBeEnabled();
  });

  it('reviews backlink-only evidence without a market', async () => {
    const review = vi.fn().mockResolvedValue(reviewedRun);
    render(
      <SearchIntelligenceReviewDrawer
        open
        action="analysis"
        readiness={{ ...readiness, preferences: { ...readiness.preferences, location_code: null } }}
        onOpenChange={vi.fn()}
        onReview={review}
        onConfirm={vi.fn()}
        busy={false}
      />,
    );
    for (const name of ['Keyword footprint', 'Ranked keywords', 'Referring domains'])
      await userEvent.click(screen.getByRole('checkbox', { name }));
    await userEvent.click(screen.getByRole('button', { name: 'Review cost' }));
    expect(review).toHaveBeenCalledWith(
      expect.objectContaining({
        location_code: null,
        datasets: [expect.objectContaining({ kind: 'referring_domains' })],
      }),
    );
  });

  it('starts from a small preset: your site and one competitor’s keyword gaps', async () => {
    const review = vi.fn().mockResolvedValue(reviewedRun);
    const competitor = (identity: string, label: string) => ({
      identity,
      label,
      registrable_domain: `${identity}.test`,
      hostname: `${identity}.test`,
      origin: `https://${identity}.test`,
      source_kind: 'competitor',
    });
    render(
      <SearchIntelligenceReviewDrawer
        open
        action="analysis"
        readiness={{
          ...readiness,
          competitors: [competitor('rival', 'Rival'), competitor('other', 'Other')],
        }}
        onOpenChange={vi.fn()}
        onReview={review}
        onConfirm={vi.fn()}
        busy={false}
      />,
    );
    // A depth can be cleared while typing; review waits for a valid number.
    const depth = screen.getByRole('textbox', { name: 'Ranked keywords: number of results' });
    await userEvent.clear(depth);
    expect(screen.getByRole('button', { name: 'Review cost' })).toBeDisabled();
    await userEvent.type(depth, '50');
    await userEvent.click(screen.getByRole('button', { name: 'Review cost' }));
    const datasets = review.mock.calls[0]![0].datasets.map(
      (item: { kind: string; competitor_id?: string; depth: number }) =>
        [item.kind, item.competitor_id ?? null, item.depth] as const,
    );
    expect(datasets).toEqual([
      ['footprint', null, 1],
      ['ranking_keywords', null, 50],
      ['missing_keywords', 'rival', 100],
      ['shared_keywords', 'rival', 100],
    ]);
  });

  it('offers every competitor, remembered ones first', async () => {
    const competitor = (identity: string, label: string) => ({
      identity,
      label,
      registrable_domain: `${identity}.test`,
      hostname: `${identity}.test`,
      origin: `https://${identity}.test`,
      source_kind: 'competitor',
    });
    render(
      <SearchIntelligenceReviewDrawer
        open
        action="analysis"
        readiness={{
          ...readiness,
          competitors: [competitor('rival', 'Rival'), competitor('other', 'Other')],
          preferences: { ...readiness.preferences, competitor_ids: ['other'] },
        }}
        onOpenChange={vi.fn()}
        onReview={vi.fn()}
        onConfirm={vi.fn()}
        busy={false}
      />,
    );
    // The remembered competitor leads; the other one is still one disclosure away.
    expect(screen.getByRole('group', { name: 'Other' })).toBeInTheDocument();
    expect(screen.getByText('Other competitors (1)')).toBeInTheDocument();
  });

  it('refuses exact-host comparisons ordered by traffic before asking for a price', async () => {
    render(
      <SearchIntelligenceReviewDrawer
        open
        action="analysis"
        readiness={{
          ...readiness,
          competitors: [
            {
              identity: 'rival',
              label: 'Rival',
              registrable_domain: 'rival.test',
              hostname: 'rival.test',
              origin: 'https://rival.test',
              source_kind: 'competitor',
            },
          ],
          preferences: { ...readiness.preferences, research_scope: 'exact_host' },
        }}
        onOpenChange={vi.fn()}
        onReview={vi.fn()}
        onConfirm={vi.fn()}
        busy={false}
      />,
    );
    await userEvent.click(screen.getByText('Advanced options'));
    await userEvent.click(screen.getByRole('combobox', { name: 'Keyword order' }));
    await userEvent.click(screen.getByRole('option', { name: 'Most estimated traffic' }));
    expect(screen.getByRole('button', { name: 'Review cost' })).toBeDisabled();
    expect(screen.getByText(/Keyword comparisons on an exact host/)).toBeInTheDocument();
  });

  it('passes suggestion acquisition controls to review', async () => {
    const review = vi.fn().mockResolvedValue(reviewedRun);
    render(
      <SearchIntelligenceReviewDrawer
        open
        action="seed"
        readiness={readiness}
        onOpenChange={vi.fn()}
        onReview={review}
        onConfirm={vi.fn()}
        busy={false}
      />,
    );
    await userEvent.click(screen.getByText('Advanced options'));
    await userEvent.click(screen.getByRole('combobox', { name: 'Keyword order' }));
    await userEvent.click(screen.getByRole('option', { name: 'Highest cost per click' }));
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Minimum search volume' }), '10');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Keyword suggestion seed' }),
      'analytics',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Review cost' }));
    expect(review).toHaveBeenCalledWith(
      expect.objectContaining({
        datasets: [
          expect.objectContaining({ kind: 'keyword_suggestions', order: 'cpc', min_volume: 10 }),
        ],
      }),
    );
  });

  it('shows review and confirmation failures and clears them when retried', async () => {
    const review = vi
      .fn()
      .mockRejectedValueOnce(new Error('Review expired'))
      .mockResolvedValue(reviewedRun);
    const confirm = vi.fn().mockRejectedValueOnce(null).mockResolvedValue(undefined);
    render(
      <SearchIntelligenceReviewDrawer
        open
        action="analysis"
        readiness={readiness}
        onOpenChange={vi.fn()}
        onReview={review}
        onConfirm={confirm}
        busy={false}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Review cost' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Review expired');
    await userEvent.click(screen.getByRole('button', { name: 'Review cost' }));
    const confirmation = await screen.findByRole('button', { name: 'Confirm $0.1442 analysis' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(confirmation);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The analysis could not be started.',
    );
    await userEvent.click(confirmation);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('shows the estimate before allowing an explicit paid confirmation', async () => {
    const review = vi.fn().mockResolvedValue(reviewedRun);
    const confirm = vi.fn().mockResolvedValue(undefined);
    render(
      <SearchIntelligenceReviewDrawer
        open
        action="analysis"
        readiness={readiness}
        onOpenChange={vi.fn()}
        onReview={review}
        onConfirm={confirm}
        busy={false}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Review cost' }));
    expect(review).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(await screen.findByText('$0.1442')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Confirm $0.1442 analysis' }));
    expect(confirm).toHaveBeenCalledWith(RUN_ID);
  });
});
