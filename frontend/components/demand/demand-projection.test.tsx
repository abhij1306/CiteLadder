import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DemandDetectorState } from '@citeladder/contracts';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { TooltipProvider } from '@/components/ui/tooltip';
import { ApiError } from '@/lib/api/errors';
import { createAppQueryClient } from '@/lib/api/query-client';
import { ActiveProjectScopeProvider } from '@/lib/project/active-project-scope';
import { makeProject } from '@/test/fixtures/project';
import { focusByKeyboard } from '@/test/keyboard-focus';
import { roles } from '@/services/api/src/config/workspaces.json';

import { ReportPage } from '@/components/templates/report-page';
import { DemandActions, DemandPanel, demandControls, useDemand } from './demand-projection';

function RouterTestWrapper({ children }: Readonly<{ children: ReactNode }>) {
  return <MemoryRouter initialEntries={['/search-intelligence']}>{children}</MemoryRouter>;
}

function signalTable() {
  return screen.getByRole('table');
}

function signalRows() {
  return within(signalTable()).getAllByRole('row').slice(1);
}

function pagerSummary() {
  return screen.getByText(
    (_, node) =>
      node?.tagName === 'OUTPUT' && /^\d+–\d+ of .* signals$/.test(node.textContent ?? ''),
  ).textContent;
}

async function findSignalRow(target: string) {
  return (await screen.findByText(target)).closest('tr')!;
}

function rankOf(row: HTMLElement) {
  return within(row).getAllByRole('cell').at(-2)!.textContent;
}

// Mutable so a test can switch projects mid-render; `vi.hoisted` keeps it
// legal inside the hoisted mock factory.
const project = vi.hoisted(() => ({
  id: '11111111-1111-4111-8111-111111111111',
  workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  capabilities: ['read', 'run', 'write'] as readonly string[],
}));

vi.mock('@/components/integrations/data-source-setup', () => ({
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
    useWorkspaceCapability: (capability: string) => project.capabilities.includes(capability),
  };
});

function DemandTab() {
  const demand = useDemand();
  return (
    <ReportPage actions={<DemandActions demand={demand} />} filters={demandControls(demand)}>
      <DemandPanel demand={demand} />
    </ReportPage>
  );
}

function DemandRoute() {
  return (
    <ActiveProjectScopeProvider
      project={makeProject({ id: project.id, workspace_id: project.workspace_id })}
    >
      <DemandTab />
    </ActiveProjectScopeProvider>
  );
}

function detector(state: DemandDetectorState, limitations: string[] = []) {
  return { state, counts_by_classification: {}, limitations };
}

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
    counts_by_type: { striking_distance: 1, high_impression_low_ctr: 1 },
    detectors: {
      striking_distance: detector('available'),
      cannibalization: detector('unavailable'),
      property_relative_ctr_gap: detector('unavailable'),
      high_impression_low_ctr: detector('available'),
      query_trends: detector('insufficient_history'),
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
  detector_policy: {
    striking_distance: { min_impressions: 50, min_position: 4, max_position: 15 },
    cannibalization: { min_page_impressions: 20, min_page_share: 0.1 },
    ctr_gap: {
      min_candidate_impressions: 100,
      relative_threshold: 0.25,
      absolute_threshold: 0.03,
      min_cohort_rows: 20,
      min_cohort_impressions: 500,
    },
    low_ctr: { min_impressions: 10, ctr_threshold: 0.02, max_signals: 50 },
    trends: { window_days: 21, required_days: 42, emerging_ratio: 1.5, declining_ratio: 0.67 },
  },
};

import { demandApi } from '@/lib/api/demand';

beforeEach(() => {
  vi.spyOn(demandApi, 'getLatest').mockResolvedValue(snapshot);
  vi.spyOn(demandApi, 'recompute').mockResolvedValue({
    task_id: '55555555-5555-4555-8555-555555555555',
    status: 'queued',
  });
});

const findSignalCount = (text: string) =>
  screen.findByText((_, element) => element?.tagName === 'SPAN' && element.textContent === text);

describe('Demand tab', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/search-intelligence');
    project.id = '11111111-1111-4111-8111-111111111111';
    project.capabilities = roles.member;
    vi.mocked(demandApi.getLatest).mockResolvedValue(snapshot);
  });

  let client: QueryClient;

  function renderProjection() {
    client = createAppQueryClient();
    return render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <DemandRoute />
        </TooltipProvider>
      </QueryClientProvider>,
      { wrapper: RouterTestWrapper },
    );
  }

  it('renders the top-strip filters carrying counts, detector status on the summary line and a flat table', async () => {
    renderProjection();

    const summary = await findSignalCount('2 signals observed');
    expect(summary.parentElement).toHaveTextContent('350 impressions on non-branded signals');
    expect(screen.queryByRole('heading', { name: 'Signals' })).not.toBeInTheDocument();

    const filters = within(screen.getByRole('radiogroup', { name: 'Signal type' }))
      .getAllByRole('radio')
      .map((chip) => chip.textContent);
    expect(filters).toEqual([
      'All signals (2)',
      'Striking distance (1)',
      'Cannibalization (0)',
      'CTR gaps (1)',
      'Trends (0)',
    ]);
    expect(
      screen.getByText('Unavailable: Cannibalization, CTR gap · Needs more history: Trends'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'How each detector works' })).toBeVisible();
    const caveats = screen.getByRole('button', { name: 'Data caveats' });
    expect(caveats).toBeVisible();
    expect(caveats).toHaveAccessibleDescription('Privacy-filtered queries may be omitted.');
    expect(screen.getByText('Privacy-filtered queries may be omitted.')).not.toBeVisible();
    expect(screen.queryByText('Latent demand')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Detectors' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Act on this' })).not.toBeInTheDocument();
    const search = screen.getByLabelText('Filter queries or pages');
    expect(
      search.compareDocumentPosition(signalTable()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const table = signalTable();
    expect(signalRows().map((row) => row.textContent)).toEqual([
      'ai marketing toolsQuery · /ai-toolsStriking distance250124.8%7.21',
      'school feesQuery · /feesLow CTR10000.0%12.02',
    ]);
    expect(within(table).queryByText('https://example.com/ai-tools')).not.toBeInTheDocument();
    expect(screen.queryByText('Within reach of the top results')).not.toBeInTheDocument();

    expect(within(table).getByText('4.8%')).toBeInTheDocument();
    expect(within(table).getByText('7.2')).toBeInTheDocument();

    const cells = within(table)
      .getAllByRole('cell')
      .map((node) => node.textContent?.trim());
    expect(cells).not.toContain('85');
    expect(cells).not.toContain('50');
    expect(screen.queryByText(/Demand overview/i)).not.toBeInTheDocument();
  });

  it('explains the signal types before the table, unchanged by the filter', async () => {
    renderProjection();

    const hint = await screen.findByRole('button', { name: 'Signal types' });
    expect(
      hint.compareDocumentPosition(signalTable()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /^Striking distance/i }));
    focusByKeyboard(screen.getByRole('button', { name: 'Signal types' }));
    expect((await screen.findByRole('tooltip')).textContent).toMatch(
      /Striking distance: .*Low CTR: Earns many impressions but few clicks/,
    );
  });

  it('keeps the reading and query relevance in the evidence drawer, quoting no unobserved benchmark', async () => {
    renderProjection();

    fireEvent.click(await findSignalRow('school fees'));

    const reading = await screen.findByRole('region', { name: 'Reading' });
    expect(within(reading).getByText(/Earns many impressions but few clicks/)).toBeInTheDocument();
    expect(screen.queryByText(/median for this position band/i)).not.toBeInTheDocument();
    const relevance = screen.getByRole('region', { name: 'Query relevance' });
    expect(relevance).toHaveTextContent('Title50.0%H10.0%Page text100.0%');
    expect(relevance).toHaveTextContent('Missing from title or H1: fees, school');
  });

  it('reads a wrongly typed coverage as not measured and keeps the rest of the relevance', async () => {
    vi.mocked(demandApi.getLatest).mockResolvedValue({
      ...snapshot,
      signals: snapshot.signals.map((signal) =>
        signal.topic_cluster === 'school fees'
          ? {
              ...signal,
              evidence: {
                ...signal.evidence,
                query_relevance: {
                  state: 'measured',
                  title_coverage: '0.5',
                  h1_coverage: 0,
                  primary_content_coverage: 1,
                },
              },
            }
          : signal,
      ),
    });
    renderProjection();

    fireEvent.click(await findSignalRow('school fees'));

    const relevance = await screen.findByRole('region', { name: 'Query relevance' });
    expect(relevance).toHaveTextContent('Title—Not measuredH10.0%Page text100.0%');
  });

  it('opens a promoted signal’s Action from its evidence and asks about the rest', async () => {
    const user = userEvent.setup();
    renderProjection();

    await user.click(await findSignalRow('ai marketing tools'));
    const drawer = await screen.findByRole('dialog', { name: 'ai marketing tools' });
    expect(
      within(drawer)
        .getByRole('link', { name: 'Open the Action for ai marketing tools' })
        .getAttribute('href'),
    ).toBe(`/actions/66666666-6666-4666-8666-666666666666?project=${project.id}`);
    await user.keyboard('{Escape}');

    await user.click(await findSignalRow('school fees'));
    const other = await screen.findByRole('dialog', { name: 'school fees' });
    expect(within(other).getByRole('link', { name: /Ask agent/ })).toBeVisible();
    expect(within(other).queryByRole('link', { name: /^Open the Action/ })).not.toBeInTheDocument();
  });

  it('inspects a signal from the keyboard on its focused row', async () => {
    const user = userEvent.setup();
    renderProjection();

    const row = await findSignalRow('school fees');
    row.focus();
    await user.keyboard('{Enter}');

    const drawer = await screen.findByRole('dialog', { name: 'school fees' });
    expect(within(drawer).getByRole('region', { name: 'Reading' })).toHaveTextContent(
      'Earns many impressions but few clicks',
    );
  });

  it('opens the evidence from a press on the row, but not from selecting its text', async () => {
    const user = userEvent.setup();
    renderProjection();
    const row = await findSignalRow('school fees');

    const selection = window.getSelection()!;
    selection.selectAllChildren(row);
    fireEvent.click(row);
    expect(screen.queryByRole('dialog', { name: 'school fees' })).not.toBeInTheDocument();

    selection.removeAllRanges();
    await user.click(row);
    expect(await screen.findByRole('dialog', { name: 'school fees' })).toBeVisible();
  });

  it('keeps a signal’s priority rank stable when a filter hides the signals above it', async () => {
    renderProjection();

    expect(await screen.findByText('ai marketing tools')).toBeInTheDocument();
    expect(signalRows().map(rankOf)).toEqual(['1', '2']);

    fireEvent.click(screen.getByRole('radio', { name: /^CTR gaps/i }));

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

    await user.click(screen.getByRole('combobox', { name: 'Rows per page for signals' }));
    await user.click(await screen.findByRole('option', { name: '25' }));
    expect(pagerSummary()).toBe('1–25 of 28 signals');
    expect(signalRows()).toHaveLength(25);

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(pagerSummary()).toBe('26–28 of 28 signals');
    expect(signalRows().map(rankOf)).toEqual(['26', '27', '28']);
    expect(
      within(signalTable())
        .getAllByRole('row', { hidden: true })
        .filter((row) => row.getAttribute('aria-hidden') === 'true'),
    ).toHaveLength(0);

    await user.click(screen.getByRole('radio', { name: /^Striking distance/i }));
    expect(pagerSummary()).toBe('1–25 of 27 signals');
    expect(rankOf(signalRows()[0]!)).toBe('1');
  });

  it('explains every detector in one info hint with its rule and what limited it', async () => {
    vi.mocked(demandApi.getLatest).mockResolvedValue({
      ...snapshot,
      summary: {
        ...snapshot.summary,
        detectors: {
          ...snapshot.summary.detectors,
          query_trends: detector('insufficient_history', [
            'At least 42 days of coverage are required.',
          ]),
        },
      },
    });
    const user = userEvent.setup();
    renderProjection();

    await user.click(await screen.findByRole('button', { name: 'How each detector works' }));

    expect((await screen.findByRole('tooltip')).textContent).toContain(
      'Trends: Queries whose impressions grew 1.5× or more, or fell to 0.67× or less, between the last two 21-day windows. Needs 42 days of continuous Search Console coverage. At least 42 days of coverage are required.',
    );
  });

  it('drops a detector from the status line once it ran, keeping its rule in the hint', async () => {
    vi.mocked(demandApi.getLatest).mockResolvedValue({
      ...snapshot,
      summary: {
        ...snapshot.summary,
        detectors: {
          ...snapshot.summary.detectors,
          property_relative_ctr_gap: detector('available', ['No cohort reached 20 queries.']),
        },
      },
    });
    const user = userEvent.setup();
    renderProjection();

    expect(
      await screen.findByText('Unavailable: Cannibalization · Needs more history: Trends'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'How each detector works' }));
    expect((await screen.findByRole('tooltip')).textContent).toMatch(
      /CTR gap: Queries with .*, and 3 points, below .* No cohort reached 20 queries\.Low CTR: Non-branded queries and pages /,
    );
  });

  it('allows filtering by signal type filter chips and searching by query text', async () => {
    renderProjection();

    expect(await screen.findByText('ai marketing tools')).toBeInTheDocument();
    expect(screen.getByText('school fees')).toBeInTheDocument();

    const strikingChip = screen.getByRole('radio', {
      name: /^Striking Distance/i,
      checked: false,
    });
    fireEvent.click(strikingChip);
    expect(strikingChip).toBeChecked();

    expect(screen.getByText('ai marketing tools')).toBeInTheDocument();
    expect(screen.queryByText('school fees')).not.toBeInTheDocument();

    const allChip = screen.getByRole('radio', { name: /^All Signals/i });
    fireEvent.click(allChip);
    expect(screen.getByText('school fees')).toBeInTheDocument();

    const searchInput = screen.getByRole('searchbox', { name: 'Filter queries or pages' });
    fireEvent.change(searchInput, { target: { value: 'fees' } });

    expect(screen.queryByText('ai marketing tools')).not.toBeInTheDocument();
    expect(screen.getByText('school fees')).toBeInTheDocument();
  });

  it('announces the initial load', async () => {
    vi.mocked(demandApi.getLatest).mockImplementation(() => new Promise(() => {}));
    renderProjection();

    expect(await screen.findByRole('status')).toHaveAccessibleName('Loading search demand…');
  });

  it('offers Search Console setup instead of signals when the snapshot has no Search Console evidence', async () => {
    vi.mocked(demandApi.getLatest).mockResolvedValue({
      ...snapshot,
      coverage: { ...snapshot.coverage, search: 'unavailable' },
    });
    renderProjection();

    expect(
      await screen.findByRole('region', { name: 'Connect Search Console' }),
    ).toBeInTheDocument();
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
      await screen.findByRole('region', { name: 'Connect Search Console' }),
    ).toBeInTheDocument();
    first.unmount();
    const readsBeforeRevisit = vi.mocked(demandApi.getLatest).mock.calls.length;

    render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <DemandRoute />
        </TooltipProvider>
      </QueryClientProvider>,
      { wrapper: RouterTestWrapper },
    );
    expect(screen.getByRole('region', { name: 'Connect Search Console' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(vi.mocked(demandApi.getLatest).mock.calls).toHaveLength(readsBeforeRevisit);
  });

  it('offers Search Console setup in place when no snapshot exists', async () => {
    vi.mocked(demandApi.getLatest).mockRejectedValue(new ApiError('No demand snapshot', 404, ''));
    renderProjection();

    expect(
      await screen.findByRole('region', { name: 'Connect Search Console' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Performance' })).not.toBeInTheDocument();
  });

  it('says when latent demand sums only the signals that reported impressions', async () => {
    vi.mocked(demandApi.getLatest).mockResolvedValue({
      ...snapshot,
      signals: [snapshot.signals[0]!, { ...snapshot.signals[1]!, metrics: { position: 12 } }],
    });
    renderProjection();

    expect((await findSignalCount('2 signals observed')).parentElement).toHaveTextContent(
      '250 impressions on 1 of 2 non-branded signals',
    );
  });

  it('opens the evidence drawer with provenance counts and no internal IDs', async () => {
    vi.mocked(demandApi.getLatest).mockResolvedValue({
      ...snapshot,
      signals: [
        {
          ...snapshot.signals[0]!,
          evidence: {
            ...snapshot.signals[0]!.evidence,
            source_metric_row_ids: ['row-1', 'row-2', 'row-3'],
          },
        },
      ],
    });
    renderProjection();

    fireEvent.click(await findSignalRow('ai marketing tools'));

    const drawer = await screen.findByRole('dialog', { name: 'ai marketing tools' });
    expect(within(drawer).queryByText('Search Console performance')).not.toBeInTheDocument();
    expect(within(drawer).queryByText('Avg. position')).not.toBeInTheDocument();
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

    expect(await findSignalCount('2 signals observed')).toBeInTheDocument();

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

    expect(await screen.findByText(/Recompute queued/i)).toBeInTheDocument();
    expect(vi.mocked(demandApi.getLatest).mock.calls).toHaveLength(fetchesBeforeRecompute);
  });

  it('shows a viewer the signals without offering a recompute', async () => {
    project.capabilities = roles.viewer;
    renderProjection();

    expect(await findSignalCount('2 signals observed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Recompute signals/i })).toBeNull();
  });

  it('shows no snapshot from the project that was just switched away from', async () => {
    const { rerender } = renderProjection();
    expect(await screen.findByText('ai marketing tools')).toBeInTheDocument();

    vi.mocked(demandApi.getLatest).mockImplementation(() => new Promise(() => {}));
    project.id = '99999999-9999-4999-8999-999999999999';
    rerender(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <DemandRoute />
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

    expect(await findSignalCount('2 signals observed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Recompute Signals/i }));

    expect(await screen.findByRole('button', { name: /Try again/i })).toBeInTheDocument();
  });
});
