import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { ApiError } from '@/lib/api/errors';
import { renderWithProviders } from '@/test/render';
import { makeProject } from '@/test/fixtures/project';

const reads = vi.hoisted(() => ({
  visibility: { data: undefined as unknown, isError: false },
  movers: { data: undefined as unknown, isError: false },
  misses: { data: undefined as unknown, isError: false },
  perception: { data: undefined as unknown, isError: false },
}));

vi.mock('@/lib/overview/widget-queries', () => ({
  WIDGET_ROWS: 5,
  useLatestVisibility: () => reads.visibility,
  useLatestMovers: () => ({
    visibility: reads.visibility,
    movers: reads.movers,
    comparison: (reads.visibility.data as { comparison?: unknown } | null | undefined)?.comparison,
  }),
  useLatestNearMisses: () => ({
    visibility: reads.visibility,
    misses: reads.misses,
  }),
  useLatestPerception: () => ({
    visibility: reads.visibility,
    perception: reads.perception,
  }),
}));

import {
  PerceptionWidget,
  RetrievalWidget,
  ShareOfVoiceWidget,
  TopMoversWidget,
} from './overview-library-widgets';

const AUDIT = '11111111-1111-4111-8111-111111111111';
const project = makeProject();

describe('Overview library widgets', () => {
  beforeEach(() => {
    reads.visibility = { data: undefined, isError: false };
    reads.movers = { data: undefined, isError: false };
    reads.misses = { data: undefined, isError: false };
    reads.perception = { data: undefined, isError: false };
  });

  it('says there is no run yet instead of loading perception forever', () => {
    // The latest projection is `null` when the project has no measured run.
    reads.visibility = { data: null, isError: false };
    renderWithProviders(<PerceptionWidget project={project} />);
    const region = screen.getByRole('region', { name: 'Perception' });
    expect(within(region).getByText('No measured run yet.')).toBeVisible();
  });

  it('says there is no run yet instead of loading top movers forever', () => {
    reads.visibility = { data: null, isError: false };
    renderWithProviders(<TopMoversWidget project={project} />);
    const region = screen.getByRole('region', { name: 'Top movers' });
    expect(within(region).getByText('No measured run yet.')).toBeVisible();
  });

  it('shows the latest-run read failure the perception widget waits on', () => {
    reads.visibility = Object.assign(
      { data: undefined, isError: true },
      { error: new Error('down'), refetch: vi.fn(), isFetching: false },
    );
    renderWithProviders(<PerceptionWidget project={project} />);
    const region = screen.getByRole('region', { name: 'Perception' });
    expect(within(region).getByRole('button', { name: /retry/i })).toBeVisible();
  });

  it.each([
    ['Perception', PerceptionWidget],
    ['Top movers', TopMoversWidget],
    ['Share of voice', ShareOfVoiceWidget],
    ['Retrieved versus cited', RetrievalWidget],
  ])('says the %s results are still being prepared, not missing or failed', (name, Widget) => {
    reads.visibility = Object.assign(
      { data: undefined, isError: true },
      {
        error: new ApiError('Metrics not available for audit', 404, '', undefined, {
          code: 'visibility_metrics_pending',
        }),
        refetch: vi.fn(),
        isFetching: false,
      },
    );
    renderWithProviders(<Widget project={project} />);
    const region = screen.getByRole('region', { name });
    expect(within(region).getByText('Results are still being prepared.')).toBeVisible();
    expect(within(region).queryByText('No measured run yet.')).toBeNull();
    expect(within(region).queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it.each([
    ['no_baseline', 0, 'No earlier run to compare with yet.'],
    ['no_baseline', 2, 'No earlier run used the same settings and scoring to compare with.'],
    ['changed_context', 0, 'The earlier run used different settings, so sources are not compared.'],
    ['matched_subset', 0, 'The earlier run used different settings, so sources are not compared.'],
    [
      'partial_coverage',
      0,
      'The latest or earlier run did not finish every answer, so shares would mislead.',
    ],
    [
      'coverage_unavailable',
      0,
      'The latest or earlier run has no expected-answer count, so its coverage cannot be checked.',
    ],
    ['no_observations', 0, 'The latest or earlier run recorded no answers to compare.'],
    [
      'identity_unavailable',
      0,
      "This run's settings could not be identified, so it is not compared.",
    ],
  ])('says why top movers are empty when the comparison is %s', (status, skipped, message) => {
    reads.visibility = {
      data: {
        audit_id: AUDIT,
        comparison: { status, baseline_audit_ids: [], skipped_runs: skipped },
      },
      isError: false,
    };
    renderWithProviders(<TopMoversWidget project={project} />);
    expect(screen.getByText(message)).toBeVisible();
  });

  it('says why the movers read could not compare the runs it was given', () => {
    reads.visibility = {
      data: { audit_id: AUDIT, comparison: { status: 'comparable', baseline_audit_ids: [AUDIT] } },
      isError: false,
    };
    reads.movers = {
      data: {
        dimension: 'domain',
        comparison_status: 'invalid_baseline',
        risers: [],
        fallers: [],
      },
      isError: false,
    };
    renderWithProviders(<TopMoversWidget project={project} />);
    expect(
      screen.getByText('The earlier run does not finish before the latest one starts.'),
    ).toBeVisible();
  });

  it('lists risers and fallers by percentage-point change', () => {
    reads.visibility = {
      data: {
        audit_id: AUDIT,
        comparison: { status: 'comparable', baseline_audit_ids: [AUDIT] },
      },
      isError: false,
    };
    reads.movers = {
      data: {
        dimension: 'domain',
        comparison_status: 'comparable',
        risers: [
          {
            key: 'review.example',
            current_share: 0.4,
            previous_share: 0.1,
            delta: 30,
          },
        ],
        fallers: [
          {
            key: 'news.example',
            current_share: 0.1,
            previous_share: 0.3,
            delta: -20,
          },
        ],
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
    const region = screen.getByRole('region', {
      name: 'Retrieved versus cited',
    });
    expect(within(region).getByText('4 read · 1 cited')).toBeVisible();
    expect(
      within(region).getByText(
        'Your pages engines read but did not cite, across 12 answers that show what they read.',
      ),
    ).toBeVisible();
  });
});
