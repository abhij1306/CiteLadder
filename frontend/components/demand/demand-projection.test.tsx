import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { TooltipProvider } from '@/components/ui/tooltip';
import { ApiError } from '@/lib/api/errors';
import { createAppQueryClient } from '@/lib/api/query-client';

import { DemandProjection } from './demand-projection';

function RouterTestWrapper({ children }: Readonly<{ children: ReactNode }>) {
  return <MemoryRouter initialEntries={['/demand']}>{children}</MemoryRouter>;
}

/** The signal table's body rows, in display order. */
function signalTable() {
  return screen.getByRole('table');
}

function signalRows() {
  return within(signalTable()).getAllByRole('row').slice(1);
}

/** The pager's announced position, e.g. "1–10 of 28 signals". */
function pagerSummary() {
  return screen.getByText(
    (_, node) =>
      node?.getAttribute('aria-live') === 'polite' && /signals$/.test(node.textContent ?? ''),
  ).textContent;
}

function rankOf(row: HTMLElement) {
  return within(row).getAllByRole('cell')[0]!.textContent;
}

// Mutable so a test can switch projects mid-render; `vi.hoisted` keeps it
// legal inside the hoisted mock factory.
const project = vi.hoisted(() => ({
  id: '11111111-1111-4111-8111-111111111111',
  workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
}));

vi.mock('@/components/integrations/data-source-setup', () => ({
  // Stands in for a connected source, so the screen's ready content renders too.
  DataSourceSetup: ({ title, whenReady }: { title: string; whenReady?: ReactNode }) => (
    <section aria-label={title}>{whenReady}</section>
  ),
}));
vi.mock('@/lib/project/project-context', () => {
  const context = () => ({
    activeProject: { id: project.id, workspace_id: project.workspace_id },
    activeProjectId: project.id,
    isLoading: false,
  });
  return {
    useActiveWorkspaceId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    useOptionalProjectContext: context,
    useProjectContext: context,
  };
});

const snapshot = {
  id: '22222222-2222-4222-8222-222222222222',
  project_id: '11111111-1111-4111-8111-111111111111',
  window_start: '2026-07-01',
  window_end: '2026-07-07',
  source_hash: 'hash',
  prior_snapshot_id: null,
  source_artifact_ids: ['artifact'],
  source_metric_row_ids: ['row'],
  coverage: {
    search: 'observed',
    traffic: 'unavailable',
    join: {
      state: 'partial',
      total_pages: 10,
      matched_pages: 4,
      join_rate: 0.4,
      excluded_pages: 2,
    },
  },
  summary: {
    signal_count: 2,
    detectors: {
      striking_distance: { state: 'available' },
      property_relative_ctr_gap: { state: 'unavailable' },
      query_trends: { state: 'insufficient_history' },
    },
  },
  comparison: null,
  formula_version: 'demand-priority-1',
  analyzer_version: 'demand-analyzer-1',
  created_at: '2026-07-08T00:00:00Z',
  signals: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      snapshot_id: '22222222-2222-4222-8222-222222222222',
      signal_type: 'striking_distance',
      state: 'active',
      topic_cluster: 'ai marketing tools',
      page_url: 'https://example.com/ai-tools',
      evidence: { target_kind: 'query', target: 'ai marketing tools' },
      metrics: { impressions: 250, clicks: 12, ctr: 0.048, position: 7.2 },
      coverage: { search_demand: 'observed' },
      limitations: ['Privacy-filtered queries may be omitted.'],
      priority_score: 85,
      priority_inputs: {},
      created_at: '2026-07-08T00:00:00Z',
      action_id: '66666666-6666-4666-8666-666666666666',
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      snapshot_id: '22222222-2222-4222-8222-222222222222',
      signal_type: 'high_impression_low_ctr',
      state: 'active',
      topic_cluster: 'school fees',
      page_url: 'https://example.com/fees',
      evidence: {
        target_kind: 'query',
        target: 'school fees',
        query_relevance: {
          state: 'measured',
          title_coverage: 0.5,
          h1_coverage: 0,
          primary_content_coverage: 1,
          absent_from_title: ['fees'],
          absent_from_h1: ['school', 'fees'],
          statement:
            'This query underperforms its CTR baseline, and important query terms are poorly represented in the inspected page.',
        },
      },
      metrics: { impressions: 100, clicks: 0, ctr: 0, position: 12.0 },
      coverage: { search_demand: 'observed' },
      limitations: ['Privacy-filtered queries may be omitted.'],
      priority_score: 50,
      priority_inputs: {},
      created_at: '2026-07-08T00:00:00Z',
      action_id: null,
    },
  ],
};

vi.mock('@/lib/api/demand', () => ({
  demandApi: {
    getLatest: vi.fn(async () => snapshot),
    // Recompute is a queued job: 202 + `queued`, never a finished snapshot.
    recompute: vi.fn(async () => ({
      task_id: '55555555-5555-4555-8555-555555555555',
      status: 'queued',
    })),
  },
}));

import { demandApi } from '@/lib/api/demand';

describe('DemandProjection', () => {
  beforeEach(() => {
    // The filter and selection live in the address, which outlives a render.
    window.history.replaceState(null, '', '/demand');
    project.id = '11111111-1111-4111-8111-111111111111';
    vi.mocked(demandApi.getLatest).mockResolvedValue(snapshot);
  });

  // Mirrors the route: `app/(authed)/(app)/demand/page.tsx` owns the TooltipProvider,
  // as every other tooltip-using page in the app does.
  let client: QueryClient;

  function renderProjection() {
    client = createAppQueryClient();
    return render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <DemandProjection />
        </TooltipProvider>
      </QueryClientProvider>,
      { wrapper: RouterTestWrapper },
    );
  }

  it('renders the top-strip filters carrying counts and detector status, a summary line and a flat table', async () => {
    renderProjection();

    // One summary line; latent demand is the only figure the filters lack.
    const summary = await screen.findByText('2 signals observed');
    expect(summary.parentElement).toHaveTextContent('350 impressions on non-branded signals'); // 250 + 100
    // No section heading: the page title already names the page.
    expect(screen.queryByRole('heading', { name: 'Signals' })).not.toBeInTheDocument();

    // Each filter carries its count once, and its detector's status when that
    // detector did not run in full, including one the snapshot never reported.
    const filters = screen
      .getAllByRole('button', { pressed: false })
      .concat(screen.getAllByRole('button', { pressed: true }))
      .map((chip) => chip.textContent);
    expect(filters).toEqual(
      expect.arrayContaining([
        'Striking distance1',
        'Cannibalization · Not reported0',
        'CTR gaps · Unavailable1',
        'Trends · Needs more history0',
      ]),
    );
    expect(screen.getByRole('button', { name: 'How the CTR gap detector works' })).toBeVisible();
    // Caveats shared by the signals sit behind one hint, not a row.
    expect(screen.getByRole('button', { name: 'Data caveats' })).toBeVisible();
    expect(screen.queryByText('Privacy-filtered queries may be omitted.')).not.toBeInTheDocument();
    // No separate summary cards, detector line or Act on this list repeat them.
    expect(screen.queryByText('Latent demand')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Detectors' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Act on this' })).not.toBeInTheDocument();
    // The search and filters sit in the page's top strip, before the table.
    const search = screen.getByLabelText('Filter queries or pages');
    expect(
      search.compareDocumentPosition(signalTable()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const table = signalTable();
    expect(signalRows().map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^1ai marketing tools\/ai-toolsStriking distance25012/),
      expect.stringMatching(/^2school fees\/feesLow CTR10000\.0%12\.0/),
    ]);
    expect(within(table).queryByText('https://example.com/ai-tools')).not.toBeInTheDocument();
    const legend = screen.getByRole('region', { name: 'Signal types' });
    expect(within(legend).getByText(/Earns many impressions but few clicks/)).toBeInTheDocument();
    expect(screen.queryByText('Within reach of the top results')).not.toBeInTheDocument();

    // Tabular metrics
    expect(within(table).getByText('4.8%')).toBeInTheDocument();
    expect(within(table).getByText('7.2')).toBeInTheDocument();

    // The internal priority score is never rendered. Asserted against the
    // table's cells specifically — a bare `queryByText('85')` would pass or
    // fail on any unrelated number that happens to format the same way.
    const cells = within(table)
      .getAllByRole('cell')
      .map((node) => node.textContent?.trim());
    expect(cells).not.toContain('85');
    expect(cells).not.toContain('50');
    expect(screen.queryByText(/Demand overview/i)).not.toBeInTheDocument();
  });

  it('keeps the reading and query relevance in the evidence drawer, quoting no unobserved benchmark', async () => {
    // `school fees` carries ctr but no `cohort_median_ctr` — the reading must
    // describe the gap without inventing a benchmark to compare against.
    renderProjection();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Inspect evidence for school fees' }),
    );

    const reading = await screen.findByRole('region', { name: 'Reading' });
    expect(within(reading).getByText(/Earns many impressions but few clicks/)).toBeInTheDocument();
    expect(screen.queryByText(/median for this position band/i)).not.toBeInTheDocument();
    const relevance = screen.getByRole('region', { name: 'Query relevance' });
    expect(relevance).toHaveTextContent('Title50%H10%Page text100%');
    expect(relevance).toHaveTextContent('Missing from title or H1: fees, school');
  });

  it('opens a promoted signal’s Action from its row and asks about the rest', async () => {
    renderProjection();

    await screen.findByText('ai marketing tools');
    const [promoted, unpromoted] = signalRows();
    // The promoted signal's row opens its Action instead of asking the agent.
    const link = within(promoted!).getByRole('link', {
      name: 'Open the Action for ai marketing tools',
    });
    expect(link.getAttribute('href')).toContain(
      '/agent/actions/66666666-6666-4666-8666-666666666666',
    );
    expect(within(promoted!).queryByRole('link', { name: /^Ask agent/ })).not.toBeInTheDocument();
    // An unpromoted signal is asked about instead.
    expect(
      within(unpromoted!).getByRole('link', { name: 'Ask agent about school fees' }),
    ).toBeVisible();
    expect(
      within(unpromoted!).queryByRole('link', { name: /^Open the Action/ }),
    ).not.toBeInTheDocument();
  });

  it('keeps a signal’s priority rank stable when a filter hides the signals above it', async () => {
    renderProjection();

    expect(await screen.findByText('ai marketing tools')).toBeInTheDocument();
    expect(signalRows().map(rankOf)).toEqual(['1', '2']);

    // `school fees` is the second-priority signal; filtering to CTR gaps must
    // not relabel it as the top-priority one.
    fireEvent.click(screen.getByRole('button', { name: /^CTR gaps/i }));

    expect(signalRows().map((row) => [rankOf(row), row.textContent])).toEqual([
      ['2', expect.stringContaining('school fees')],
    ]);
  });

  it('pages a long signal list with rows per page, restarting at page 1 on a new filter', async () => {
    const strikingRows = Array.from({ length: 27 }, (_, index) => ({
      ...snapshot.signals[0]!,
      id: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`,
      evidence: { target_kind: 'query', target: `query ${index + 1}` },
      action_id: null,
    }));
    vi.mocked(demandApi.getLatest).mockResolvedValue({
      ...snapshot,
      signals: [...strikingRows, snapshot.signals[1]!],
    });
    const user = userEvent.setup();
    renderProjection();

    await screen.findByText('query 1');
    expect(pagerSummary()).toBe('1–10 of 28 signals');
    expect(signalRows()).toHaveLength(10);

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(pagerSummary()).toBe('11–20 of 28 signals');
    expect(signalRows().map(rankOf)).toEqual([
      '11',
      '12',
      '13',
      '14',
      '15',
      '16',
      '17',
      '18',
      '19',
      '20',
    ]);

    // A larger page size shows more rows and starts again from the top.
    await user.click(screen.getByRole('combobox', { name: 'Rows per page for signals' }));
    await user.click(await screen.findByRole('option', { name: '25' }));
    expect(pagerSummary()).toBe('1–25 of 28 signals');
    expect(signalRows()).toHaveLength(25);

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(pagerSummary()).toBe('26–28 of 28 signals');
    expect(signalRows().map(rankOf)).toEqual(['26', '27', '28']);
    // The short last page keeps a full page's height: blank rows, hidden from
    // assistive technology, hold the pager where it was.
    expect(
      within(signalTable())
        .getAllByRole('row', { hidden: true })
        .filter((row) => row.getAttribute('aria-hidden') === 'true'),
    ).toHaveLength(22);

    // A different filter is a different list: it opens on its first page.
    await user.click(screen.getByRole('button', { name: /^Striking distance/i }));
    expect(pagerSummary()).toBe('1–25 of 27 signals');
    expect(rankOf(signalRows()[0]!)).toBe('1');
  });

  it('explains each detector in an info hint with its rule and what limited it', async () => {
    vi.mocked(demandApi.getLatest).mockResolvedValue({
      ...snapshot,
      summary: {
        ...snapshot.summary,
        detectors: {
          ...snapshot.summary.detectors,
          query_trends: {
            state: 'insufficient_history',
            limitations: ['At least 28 days of coverage are required.'],
          },
        },
      },
    });
    const user = userEvent.setup();
    renderProjection();

    await user.hover(await screen.findByRole('button', { name: 'How the Trends detector works' }));

    // The rule first, then the snapshot's own reason the detector is held back.
    expect((await screen.findByRole('tooltip')).textContent).toMatch(
      /last two 14-day windows\..* At least 28 days of coverage are required\.$/,
    );
  });

  it('allows filtering by signal type filter chips and searching by query text', async () => {
    renderProjection();

    expect(await screen.findByText('ai marketing tools')).toBeInTheDocument();
    expect(screen.getByText('school fees')).toBeInTheDocument();

    // Click Striking Distance filter chip (using aria-pressed)
    const strikingChip = screen.getByRole('button', {
      name: /^Striking Distance/i,
      pressed: false,
    });
    fireEvent.click(strikingChip);

    expect(screen.getByText('ai marketing tools')).toBeInTheDocument();
    expect(screen.queryByText('school fees')).not.toBeInTheDocument();

    // Click All Signals chip
    const allChip = screen.getByRole('button', { name: /^All Signals/i });
    fireEvent.click(allChip);
    expect(screen.getByText('school fees')).toBeInTheDocument();

    // Search query
    const searchInput = screen.getByRole('searchbox', { name: 'Filter queries or pages' });
    fireEvent.change(searchInput, { target: { value: 'fees' } });

    expect(screen.queryByText('ai marketing tools')).not.toBeInTheDocument();
    expect(screen.getByText('school fees')).toBeInTheDocument();
  });

  it('announces the initial load', async () => {
    vi.mocked(demandApi.getLatest).mockImplementation(
      () =>
        new Promise(() => {
          // Intentionally pending so the loading state stays rendered.
        }),
    );
    renderProjection();

    expect(await screen.findByRole('status')).toHaveAccessibleName('Loading search demand…');
  });

  it('offers Search Console setup instead of signals when the snapshot has no Search Console evidence', async () => {
    vi.mocked(demandApi.getLatest).mockResolvedValue({
      ...snapshot,
      coverage: { ...snapshot.coverage, search: 'unavailable' },
    });
    renderProjection();

    expect(await screen.findByRole('region', { name: 'Connect Search Console' })).toHaveTextContent(
      'Search Demand appears after the next Search Console import.',
    );
    expect(screen.queryByText('school fees')).not.toBeInTheDocument();
  });

  it('states that observed Search Console data had no qualifying gaps', async () => {
    vi.mocked(demandApi.getLatest).mockResolvedValue({ ...snapshot, signals: [] });
    renderProjection();

    expect(await screen.findByText(/no qualifying search gaps observed/i)).toBeInTheDocument();
  });

  it('answers a revisit without a snapshot from cache instead of reloading the skeleton', async () => {
    vi.mocked(demandApi.getLatest).mockRejectedValue(new ApiError('No demand snapshot', 404, ''));
    const first = renderProjection();
    expect(
      await screen.findByText('Search Demand appears after the next Search Console import.'),
    ).toBeInTheDocument();
    first.unmount();
    const readsBeforeRevisit = vi.mocked(demandApi.getLatest).mock.calls.length;

    render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <DemandProjection />
        </TooltipProvider>
      </QueryClientProvider>,
      { wrapper: RouterTestWrapper },
    );
    expect(
      screen.getByText('Search Demand appears after the next Search Console import.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(vi.mocked(demandApi.getLatest).mock.calls).toHaveLength(readsBeforeRevisit);
  });

  it('offers Search Console setup in place when no snapshot exists', async () => {
    vi.mocked(demandApi.getLatest).mockRejectedValue(new ApiError('No demand snapshot', 404, ''));
    renderProjection();

    expect(
      await screen.findByText('Search Demand appears after the next Search Console import.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Connect Search Console' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Performance' })).not.toBeInTheDocument();
  });

  it('says when latent demand sums only the signals that reported impressions', async () => {
    vi.mocked(demandApi.getLatest).mockResolvedValue({
      ...snapshot,
      signals: [snapshot.signals[0]!, { ...snapshot.signals[1]!, metrics: { position: 12 } }],
    });
    renderProjection();

    expect((await screen.findByText('2 signals observed')).parentElement).toHaveTextContent(
      '250 impressions on 1 of 2 non-branded signals',
    );
  });

  it('opens the evidence drawer with provenance counts and no internal IDs', async () => {
    vi.mocked(demandApi.getLatest).mockResolvedValue({
      ...snapshot,
      signals: [
        {
          ...snapshot.signals[0]!,
          // Rows recorded; source imports never were, which is not zero.
          evidence: {
            ...snapshot.signals[0]!.evidence,
            source_metric_row_ids: ['row-1', 'row-2', 'row-3'],
          },
        },
      ],
    });
    renderProjection();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Inspect evidence for ai marketing tools' }),
    );

    const drawer = await screen.findByRole('dialog', { name: 'Signal evidence' });
    expect(within(drawer).getByText('Search Console performance')).toBeInTheDocument();
    const provenance = within(drawer).getByRole('region', { name: 'Provenance' });
    expect(provenance).toHaveTextContent('Search Console rows3');
    expect(provenance).toHaveTextContent('Source imports');
    expect(provenance).toHaveTextContent('Not measured');
    expect(provenance).not.toHaveTextContent('Source imports0');
    expect(drawer).not.toHaveTextContent('33333333');
    expect(drawer).not.toHaveTextContent('22222222');
  });

  it('reports that recompute was queued rather than implying a finished rebuild', async () => {
    renderProjection();

    expect(await screen.findByText('2 signals observed')).toBeInTheDocument();

    const fetchesBeforeRecompute = vi.mocked(demandApi.getLatest).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /Recompute Signals/i }));

    await waitFor(() => {
      expect(demandApi.recompute).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        {
          window_start: '2026-07-01',
          window_end: '2026-07-07',
        },
        { workspaceId: project.workspace_id },
      );
    });

    // The worker has not run yet, so the UI must say the job is queued and
    // must NOT silently refetch the identical snapshot as if it had rebuilt.
    expect(await screen.findByText(/Recompute queued/i)).toBeInTheDocument();
    expect(vi.mocked(demandApi.getLatest).mock.calls).toHaveLength(fetchesBeforeRecompute);
  });

  it('shows no snapshot from the project that was just switched away from', async () => {
    // With `keepPreviousData` the previous project's snapshot renders as a
    // success (placeholder data is not `isLoading`), so the view would show one
    // project's demand signals while recomputing against another project's id.
    const { rerender } = renderProjection();
    expect(await screen.findByText('ai marketing tools')).toBeInTheDocument();

    vi.mocked(demandApi.getLatest).mockImplementation(
      () =>
        new Promise(() => {
          // The second project's read stays in flight.
        }),
    );
    project.id = '99999999-9999-4999-8999-999999999999';
    rerender(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <DemandProjection />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveAccessibleName('Loading search demand…');
    });
    expect(screen.queryByText('ai marketing tools')).not.toBeInTheDocument();
  });

  it('surfaces a recompute failure instead of returning silently to idle', async () => {
    vi.mocked(demandApi.recompute).mockRejectedValueOnce(new Error('boom'));
    renderProjection();

    expect(await screen.findByText('2 signals observed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Recompute Signals/i }));

    expect(await screen.findByRole('button', { name: /Try again/i })).toBeInTheDocument();
  });
});
