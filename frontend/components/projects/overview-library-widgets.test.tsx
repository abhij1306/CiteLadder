import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { renderWithProviders } from '@/test/render';
import { makeProject } from '@/test/fixtures/project';

const reads = vi.hoisted(() => ({
  visibility: { data: undefined as unknown, isError: false },
  movers: { data: undefined as unknown, isError: false },
  misses: { data: undefined as unknown, isError: false },
}));

vi.mock('@/lib/overview/widget-queries', () => ({
  WIDGET_ROWS: 5,
  useLatestVisibility: () => reads.visibility,
  useLatestMovers: () => ({
    visibility: reads.visibility,
    movers: reads.movers,
    comparable:
      (reads.visibility.data as { comparison?: { status: string } } | undefined)?.comparison
        ?.status === 'comparable',
  }),
  useLatestNearMisses: () => ({ visibility: reads.visibility, misses: reads.misses }),
}));

import { RetrievalWidget, ShareOfVoiceWidget, TopMoversWidget } from './overview-library-widgets';

const AUDIT = '11111111-1111-4111-8111-111111111111';
const project = makeProject();

describe('Overview library widgets', () => {
  beforeEach(() => {
    reads.visibility = { data: undefined, isError: false };
    reads.movers = { data: undefined, isError: false };
    reads.misses = { data: undefined, isError: false };
  });

  it('says why top movers are empty before a comparable run', () => {
    reads.visibility = {
      data: { audit_id: AUDIT, comparison: { status: 'no_baseline', baseline_audit_ids: [] } },
      isError: false,
    };
    renderWithProviders(<TopMoversWidget project={project} />);
    expect(screen.getByText('No comparable earlier run to compare with yet.')).toBeVisible();
  });

  it('lists risers and fallers by percentage-point change', () => {
    reads.visibility = {
      data: { audit_id: AUDIT, comparison: { status: 'comparable', baseline_audit_ids: [AUDIT] } },
      isError: false,
    };
    reads.movers = {
      data: {
        dimension: 'domain',
        comparison_status: 'comparable',
        risers: [{ key: 'review.example', current_share: 0.4, previous_share: 0.1, delta: 30 }],
        fallers: [{ key: 'news.example', current_share: 0.1, previous_share: 0.3, delta: -20 }],
      },
      isError: false,
    };
    renderWithProviders(<TopMoversWidget project={project} />);
    const region = screen.getByRole('region', { name: 'Top movers' });
    expect(within(region).getByText('+30 pp')).toBeVisible();
    expect(within(region).getByText('-20 pp')).toBeVisible();
  });

  it('ranks brands by share of voice and keeps a full list footprint', () => {
    reads.visibility = {
      data: {
        audit_id: AUDIT,
        rankings: [
          { name: 'Acme', is_brand: true, share_of_voice: 0.42 },
          { name: 'Globex', is_brand: false, share_of_voice: 0.3 },
        ],
      },
      isError: false,
    };
    renderWithProviders(<ShareOfVoiceWidget project={project} />);
    const region = screen.getByRole('region', { name: 'Share of voice' });
    expect(within(region).getByText('42%')).toBeVisible();
    expect(within(region).getByText('30%')).toBeVisible();
    expect(within(region).getAllByRole('listitem', { hidden: true })).toHaveLength(5);
  });

  it('lists owned pages engines read but did not cite', () => {
    reads.visibility = { data: { audit_id: AUDIT }, isError: false };
    reads.misses = {
      data: {
        responses: 12,
        unavailable_engines: ['gemini'],
        items: [
          {
            url: 'https://acme.com/pricing',
            url_hash: 'h',
            domain: 'acme.com',
            title: 'Pricing',
            retrieved: 4,
            cited: 1,
            last_retrieved_at: '2026-10-01T00:00:00Z',
          },
        ],
      },
      isError: false,
    };
    renderWithProviders(<RetrievalWidget project={project} />);
    const region = screen.getByRole('region', { name: 'Retrieved versus cited' });
    expect(within(region).getByText('4 read · 1 cited')).toBeVisible();
    expect(
      within(region).getByText(
        'Your pages engines read but did not cite, across 12 answers that show what they read.',
      ),
    ).toBeVisible();
  });
});
