import { render as raw, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
const { project, downloadOverviewReport, queryResult, promptsResult, layoutResult, role } =
  vi.hoisted(() => ({
    project: {
      id: '00000000-0000-4000-8000-000000000001',
      workspace_id: '00000000-0000-4000-8000-000000000002',
      name: 'Acme',
      brand_name: 'Acme',
      website_url: 'https://acme.com',
      brand: { aliases: [], logo_url: null },
      competitors: [],
    },
    downloadOverviewReport: vi.fn().mockResolvedValue(new Blob(['pdf'])),
    // The project's saved Overview layout; the default until a test changes it.
    layoutResult: {
      data: undefined as unknown,
      error: null as unknown,
      isError: false,
      isFetching: false,
      refetch: () => undefined,
    },
    role: { canWrite: true },
    queryResult: {
      data: undefined as unknown,
      error: null as unknown,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    },
    // The latest run's prompt results, read by "Where you're missing".
    promptsResult: {
      data: [] as unknown,
      error: null as unknown,
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    },
  }));
const commandCenter = {
  project,
  facts: {
    industry: 'Software',
    description: 'Analytics for growth teams',
    positioning: 'Evidence-first analytics',
    products_services: ['Analytics'],
    target_audience: 'Growth leaders',
    competitors: [],
  },
  loop: {
    connected: {
      state: 'observed',
      observed_at: '2026-07-27T00:00:00Z',
      freshness: 'current',
      coverage: ['gsc'],
      limitations: [],
    },
    analyzed: {
      state: 'partial',
      observed_at: '2026-07-27T00:00:00Z',
      freshness: 'current',
      coverage: ['site_health'],
      limitations: ['Search Demand has not refreshed yet.'],
    },
    acted: {
      state: 'not_run',
      observed_at: null,
      freshness: 'unknown',
      coverage: [],
      limitations: ['No current-cycle implementation.'],
    },
    tracked: {
      state: 'observed',
      observed_at: '2026-07-28T00:00:00Z',
      freshness: 'current',
      coverage: ['chatgpt', 'gemini'],
      limitations: [],
    },
  },
  next_action: {
    kind: 'monitor',
    title: 'Monitor — no required action',
    href: '/visibility?tab=trends',
    opportunity_id: null,
  },
  active_prompt_count: 12,
  track: {
    citation_share: { value: 32.5, delta: 2.1 },
    engine_coverage: 2,
    observed_at: '2026-07-28T00:00:00Z',
    limitations: [],
  },
  measurement: {
    audit_id: '00000000-0000-4000-8000-000000000003',
    completed_at: '2026-07-28T00:00:00Z',
    benchmark_mode: 'consumer_like',
    logical_engines: ['chatgpt', 'gemini'],
    comparable_audit_id: '00000000-0000-4000-8000-000000000004',
  },
  state: {
    visibility: { value: 72.5, delta: 4.2 },
    share_of_voice: { value: 48.1, delta: 3.1 },
    brand_rank: { value: 2, delta: -1 },
  },
  movements: [
    { label: 'visibility', direction: 'positive', current: 72.5, previous: 68.3, delta: 4.2 },
  ],
  actions: [],
  action_order_version: 0,
  resolved_actions: {
    since_audit_id: '00000000-0000-4000-8000-000000000004',
    count: 2,
    titles: ['Fixed citations', 'Expanded evidence'],
  },
  report_available: true,
  stale: false,
};

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: readonly unknown[] }) => {
    if (options.queryKey[1] === 'overview-layout') return layoutResult;
    return options.queryKey[0] === 'visibility' ? promptsResult : queryResult;
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/lib/project/project-context', () => {
  const context = () => ({
    projects: [project],
    activeProject: project,
    activeProjectId: project.id,
    setActiveProjectId: vi.fn(),
    isLoading: false,
  });
  return {
    useActiveWorkspaceId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    // `ProjectControls` gates the create affordance on the caller's role as
    // well as on the remaining allowance; this fixture is an Owner.
    useWorkspaceCapability: () => role.canWrite,
    useActiveProject: () => project,
    useOptionalProjectContext: context,
    useProjectContext: context,
  };
});
vi.mock('@/lib/api/projects', () => ({
  projectsApi: { getCommandCenter: vi.fn(), downloadOverviewReport },
}));
vi.mock('@/lib/api/opportunities', () => ({
  opportunitiesApi: { updateOrder: vi.fn() },
}));
import { TooltipProvider } from '@/components/ui/tooltip';
import { DashboardScreen } from './dashboard-screen';

function RouterTestWrapper({ children }: Readonly<{ children: ReactNode }>) {
  return <MemoryRouter initialEntries={['/projects']}>{children}</MemoryRouter>;
}

function renderDashboard(ui: ReactElement) {
  return raw(ui, { wrapper: RouterTestWrapper });
}

const DEFAULT_LAYOUT = {
  widgets: [
    { key: 'project_state', size: 'half' },
    { key: 'citation_share', size: 'half' },
    { key: 'movement', size: 'half' },
    { key: 'next_action', size: 'half' },
    { key: 'missing_prompts', size: 'full' },
    { key: 'ranked_actions', size: 'half' },
    { key: 'progress_proof', size: 'half' },
    { key: 'company_facts', size: 'full' },
  ],
  version: 0,
  customized: false,
  updated_at: null,
};
describe('DashboardScreen', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    queryResult.data = commandCenter;
    queryResult.error = null;
    queryResult.isLoading = false;
    queryResult.isError = false;
    queryResult.refetch.mockReset();
    promptsResult.data = [];
    layoutResult.data = DEFAULT_LAYOUT;
    role.canWrite = true;
  });
  it('renders state, comparable movement, actions, and report proof', () => {
    renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Acme' })).toBeInTheDocument();
    // Visibility is a mention rate, so the tile carries a percent unit.
    expect(
      within(screen.getByRole('region', { name: 'Project state' })).getByText('72.5%'),
    ).toBeInTheDocument();
    // Rank is better when it falls, so climbing one place reads as an improvement.
    expect(
      within(screen.getByRole('region', { name: 'Project state' }))
        .getByText('−1.0 vs previous')
        .closest('[data-outcome]'),
    ).toHaveAttribute('data-outcome', 'improved');
    expect(screen.getByRole('heading', { name: 'Project state' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Movement' })).getByText('68.3%'),
    ).toBeVisible();
    // With no open actions the section is only its empty state, still linking to every action.
    expect(screen.getByRole('heading', { name: 'No open actions' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Ranked actions' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute(
      'href',
      '/agent/actions?project=00000000-0000-4000-8000-000000000001',
    );
    expect(
      within(screen.getByRole('region', { name: 'Progress and report proof' })).getByText(
        '2 actions resolved since the comparable run.',
      ),
    ).toBeVisible();
    expect(screen.getByText('Evidence-first analytics')).toBeVisible();
    expect(screen.getByText('Growth leaders')).toBeVisible();
    expect(screen.getByText('Analytics')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Company facts' })).toBeVisible();
    expect(screen.getByText('Monitor — no required action')).toBeVisible();
  });
  it('ranks open actions with their evidence and links each to its Action', () => {
    queryResult.data = {
      ...commandCenter,
      actions: [
        {
          id: '00000000-0000-4000-8000-0000000000c1',
          action_id: '00000000-0000-4000-8000-0000000000d1',
          title: 'Publish a comparison page',
          severity: 'critical',
          target_label: '/pricing',
          evidence_summary: { count: 3 },
          priority_score: 7.46,
        },
      ],
    };
    renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
    );
    const ranked = within(screen.getByRole('region', { name: 'Ranked actions' }));
    expect(ranked.getByRole('link', { name: 'Publish a comparison page' })).toHaveAttribute(
      'href',
      '/agent/actions/00000000-0000-4000-8000-0000000000d1?project=00000000-0000-4000-8000-000000000001',
    );
    expect(ranked.getByText('/pricing · 3 persisted evidence item(s)')).toBeVisible();
    expect(ranked.getByText('7.5')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'No open actions' })).not.toBeInTheDocument();
  });
  it('shows an empty state instead of a movement card before a comparable run', () => {
    queryResult.data = { ...commandCenter, movements: [] };
    renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
    );
    expect(screen.getByRole('heading', { name: 'No comparable measurement yet' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Movement' })).not.toBeInTheDocument();
  });
  it("lists prompts where answers named a competitor but not the brand, with each prompt's Action", () => {
    const outcome = (engine: string, gaps: Record<string, number>) => ({
      logical_engine: engine,
      transport_model: 'model',
      counts: {
        state: 'measured',
        responses: 2,
        brand_responses: 0,
        owned_citation_responses: 0,
        entity_presences: null,
        expected: 2,
        failed: 0,
        not_run: 0,
      },
      visibility_rate: 0,
      owned_citation_rate: 0,
      gap_counts: gaps,
    });
    const item = (id: string, text: string, actionId: string | null, outcomes: unknown[]) => ({
      prompt_id: id,
      prompt_text: text,
      action_id: actionId,
      outcomes,
    });
    promptsResult.data = [
      item('00000000-0000-4000-8000-0000000000a1', 'best crm', null, [
        outcome('chatgpt', { Globex: 1 }),
      ]),
      item(
        '00000000-0000-4000-8000-0000000000a2',
        'crm for agencies',
        '00000000-0000-4000-8000-0000000000b2',
        [outcome('chatgpt', { Globex: 2, Initech: 1 }), outcome('gemini', { Globex: 1 })],
      ),
      item('00000000-0000-4000-8000-0000000000a3', 'what is a crm', null, [outcome('claude', {})]),
    ];
    renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
    );

    const section = within(screen.getByRole('region', { name: "Where you're missing" }));
    const rows = section.getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'crm for agenciesChatGPT API, Gemini API named Globex, InitechOpen the Action',
      'best crmChatGPT API named GlobexNo Action yet',
    ]);
    expect(section.getByRole('link', { name: 'Open the Action' })).toHaveAttribute(
      'href',
      '/agent/actions/00000000-0000-4000-8000-0000000000b2?project=00000000-0000-4000-8000-000000000001',
    );
    expect(section.getByRole('link', { name: 'best crm' })).toHaveAttribute(
      'href',
      '/prompts/00000000-0000-4000-8000-0000000000a1?project=00000000-0000-4000-8000-000000000001',
    );
  });

  it('does not remount unrelated dashboard state when the action order changes', () => {
    const view = renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
    );
    const companyFacts = screen.getByRole('heading', { name: 'Company facts' });
    queryResult.data = { ...commandCenter, action_order_version: 1 };

    view.rerender(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Company facts' })).toBe(companyFacts);
  });
  it('shows only the saved widgets, in the saved order', () => {
    layoutResult.data = {
      ...DEFAULT_LAYOUT,
      widgets: [
        { key: 'company_facts', size: 'full' },
        { key: 'project_state', size: 'half' },
      ],
      version: 3,
      customized: true,
    };
    const { container } = renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
    );
    expect(
      [...container.querySelectorAll('[data-widget]')].map((cell) =>
        cell.getAttribute('data-widget'),
      ),
    ).toEqual(['company_facts', 'project_state']);
    expect(screen.queryByRole('heading', { name: 'Movement' })).not.toBeInTheDocument();
  });
  it('offers the layout menu to editors only', () => {
    renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Layout' })).toBeVisible();
  });
  it('hides the layout menu from viewers', () => {
    role.canWrite = false;
    renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Layout' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export pdf/i })).toBeVisible();
  });
  it('downloads the authenticated Overview PDF', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => 'blob:report');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = revokeObjectURL;
      },
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
    );
    expect(screen.getAllByRole('button', { name: /export pdf/i })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /export pdf/i }));
    expect(downloadOverviewReport).toHaveBeenCalledWith(project.id, {
      workspaceId: project.workspace_id,
    });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
  });
  it('shows a recoverable error when report download fails', async () => {
    downloadOverviewReport.mockRejectedValueOnce(new Error('download failed'));
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = vi.fn(() => 'blob:report');
        static revokeObjectURL = vi.fn();
      },
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
    );
    await user.click(screen.getByRole('button', { name: /export pdf/i }));
    expect(await screen.findByText('The report could not be downloaded. Try again.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /export pdf/i }));
    await waitFor(() =>
      expect(
        screen.queryByText('The report could not be downloaded. Try again.'),
      ).not.toBeInTheDocument(),
    );
  });
  it('renders facts and a real next action before the first audit', () => {
    queryResult.data = {
      ...commandCenter,
      measurement: null,
      report_available: false,
      track: {
        citation_share: { value: null, delta: null },
        engine_coverage: 0,
        observed_at: null,
        limitations: ['No visibility audit has run yet.'],
      },
      loop: {
        ...commandCenter.loop,
        tracked: {
          state: 'not_run',
          observed_at: null,
          freshness: 'unknown',
          coverage: [],
          limitations: ['No visibility audit has run yet.'],
        },
      },
      next_action: {
        kind: 'audit',
        title: 'Run the first visibility audit',
        href: '/runs',
        opportunity_id: null,
      },
    };
    renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Company facts' })).toBeVisible();
    // The Product loop strip was removed from Overview; loop evidence still
    // arrives on the projection but no longer has a station-tile surface.
    expect(screen.queryByRole('heading', { name: 'Product loop' })).not.toBeInTheDocument();
    expect(screen.getByText('Run the first visibility audit')).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Citation share' })).getByText('Not run'),
    ).toBeVisible();
    // The PDF exports the layout, so it is available before the first audit too.
    expect(screen.getByRole('button', { name: /export pdf/i })).toBeVisible();
  });
  it('asks a project with no active prompts to choose what to track', () => {
    queryResult.data = { ...commandCenter, active_prompt_count: 0 };
    renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
    );
    const setup = screen.getByRole('region', { name: 'Choose the questions you want to track' });
    expect(within(setup).getByRole('link', { name: 'Generate prompts' })).toHaveAttribute(
      'href',
      expect.stringContaining('/prompts?generate=1'),
    );
    expect(within(setup).getByRole('link', { name: 'Add or import prompts' })).toBeVisible();
  });
  it('omits prompt setup once the project tracks prompts', () => {
    renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
    );
    expect(
      screen.queryByRole('region', { name: 'Choose the questions you want to track' }),
    ).not.toBeInTheDocument();
  });
  it('labels a null citation share from an observed run as unavailable', () => {
    queryResult.data = {
      ...commandCenter,
      track: {
        ...commandCenter.track,
        citation_share: { value: null, delta: null },
        limitations: ['The completed audit did not produce a citation-share value.'],
      },
    };
    renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
    );
    expect(
      within(screen.getByRole('region', { name: 'Citation share' })).getByText('Unavailable'),
    ).toBeVisible();
  });
  it('keeps observed zero distinct from an unavailable value', () => {
    queryResult.data = {
      ...commandCenter,
      track: {
        ...commandCenter.track,
        citation_share: { value: 0, delta: 0 },
      },
    };
    renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
    );
    expect(screen.getByText('0%')).toBeVisible();
    expect(screen.queryByText('Not measured')).not.toBeInTheDocument();
  });
});
