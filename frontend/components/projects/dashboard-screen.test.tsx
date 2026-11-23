import { render as raw, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vite-plus/test';
const { project, downloadOverviewReport, queryResult, promptsResult, layoutResult } = vi.hoisted(
  () => ({
    project: {
      id: '00000000-0000-4000-8000-000000000001',
      workspace_id: '00000000-0000-4000-8000-000000000002',
      name: 'Acme',
      brand_name: 'Acme',
      website_url: 'https://acme.com',
      brand: { alias_suggestions: [], aliases: [], logo_url: null },
      competitors: [],
    },
    downloadOverviewReport: vi.fn().mockResolvedValue(new Blob(['pdf'])),
    layoutResult: {
      data: undefined as unknown,
      error: null as unknown,
      isError: false,
      isFetching: false,
      refetch: () => undefined,
    },
    queryResult: {
      data: undefined as unknown,
      error: null as unknown,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    },
    promptsResult: {
      data: [] as unknown,
      error: null as unknown,
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    },
  }),
);
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
    href: '/insights',
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
    comparison_status: 'comparable',
  },
  state: {
    visibility: { value: 72.5, delta: 4.2 },
    share_of_voice: { value: 48.1, delta: 3.1 },
    brand_rank: { value: 2, delta: -1 },
  },
  movements: [
    { label: 'chatgpt', direction: 'positive', current: 72.5, previous: 68.3, delta: 4.2 },
  ],
  actions: [],
  action_order_version: 0,
  report_available: true,
  stale: false,
};

const promptSetsResult = vi.hoisted(() => ({
  status: 'success',
  data: { prompt_sets: [{ prompts: [{ enabled: true, status: 'active' }] }] },
}));
// The Launch audit dialog has its own suite; here only whether it opens matters.
vi.mock('@/components/runs/launch-dialog', () => ({
  LaunchDialog: ({ open }: { open: boolean }) =>
    open ? <dialog open aria-label="Launch run" /> : null,
}));
vi.mock('@tanstack/react-query', () => ({
  queryOptions: <T,>(options: T) => options,
  useQuery: (options: { queryKey: readonly unknown[] }) => {
    if (options.queryKey[0] === 'providers') return { data: providerCatalogFixture };
    if (options.queryKey[0] === 'prompts') return promptSetsResult;
    if (options.queryKey[1] === 'overview-layout') return layoutResult;
    return options.queryKey[0] === 'visibility' ? promptsResult : queryResult;
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/lib/api/projects', () => ({
  projectsApi: { getCommandCenter: vi.fn(), downloadOverviewReport },
  projectQueries: {
    commandCenter: ({ projectId }: { projectId: string }) => ({
      queryKey: ['projects', 'command-center', projectId],
    }),
    overviewLayout: ({ projectId }: { projectId: string }) => ({
      queryKey: ['projects', 'overview-layout', projectId],
    }),
  },
  projectMutations: { reorderActions: () => ({}), saveOverviewLayout: () => ({}) },
}));
vi.mock('@/lib/api/opportunities', () => ({
  opportunitiesApi: { updateOrder: vi.fn() },
}));
import { TooltipProvider } from '@/components/ui/tooltip';
import { ActiveProjectScopeProvider } from '@/lib/project/active-project-scope';
import { ProjectSelectionProvider } from '@/lib/project/project-scope';
import { projectScope, testProjectSelection, type TestRole } from '@/test/render';
import { makeProject } from '@/test/fixtures/project';
import { providerCatalogFixture } from '@/test/provider-catalog-fixture';
import { DashboardScreen } from './dashboard-screen';

const scopeProject = makeProject({
  id: project.id,
  workspace_id: project.workspace_id,
  name: project.name,
  brand_name: project.brand_name,
  website_url: project.website_url,
});

function renderDashboard(ui: ReactElement, role: TestRole = 'owner') {
  const selection = testProjectSelection(projectScope(scopeProject, role));
  function RouterTestWrapper({ children }: Readonly<{ children: ReactNode }>) {
    return (
      <MemoryRouter initialEntries={['/projects']}>
        <ProjectSelectionProvider value={selection}>
          <ActiveProjectScopeProvider project={scopeProject}>{children}</ActiveProjectScopeProvider>
        </ProjectSelectionProvider>
      </MemoryRouter>
    );
  }
  return raw(ui, { wrapper: RouterTestWrapper });
}

async function openPageActions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Page actions' }));
  return screen.findByRole('menu');
}

async function exportPdf(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    within(await openPageActions(user)).getByRole('menuitem', { name: 'Export PDF' }),
  );
}

const DEFAULT_LAYOUT = {
  widgets: [
    { key: 'project_state', size: 'full' },
    { key: 'movement', size: 'half' },
    { key: 'next_action', size: 'half' },
    { key: 'missing_prompts', size: 'full' },
    { key: 'ranked_actions', size: 'full' },
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
  });
  it('renders state, comparable movement and actions', () => {
    renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
    );
    expect(screen.queryByRole('heading', { name: 'Acme' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^acme\.com/ })).toHaveAttribute(
      'href',
      'https://acme.com/',
    );
    expect(screen.getByText(/^Tracked .*· ChatGPT API, Gemini API$/u)).toBeVisible();
    const state = within(screen.getByRole('region', { name: 'Project state' }));
    expect(state.getByText('Visibility')).toBeVisible();
    expect(state.getByText('72.5%')).toBeVisible();
    expect(state.getByText('Share of voice')).toBeVisible();
    expect(state.getByText('48.1%')).toBeVisible();
    expect(state.getByText('Rank')).toBeVisible();
    expect(state.getByText('#2')).toBeVisible();
    expect(state.queryByText('Brand rank')).not.toBeInTheDocument();
    const rankChange = state
      .getAllByText('compared with the previous run')
      .map((context) => context.closest('[data-outcome]'))
      .find((delta) => delta?.textContent === 'down −1 compared with the previous run');
    expect(rankChange).toHaveAttribute('data-outcome', 'improved');
    expect(screen.queryByText('vs previous')).toBeNull();
    expect(
      within(screen.getByRole('region', { name: 'Project state' })).getByText('32.5%'),
    ).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Movement' })).getByText('68.3%'),
    ).toBeVisible();
    const ranked = within(screen.getByRole('region', { name: 'Ranked actions' }));
    expect(ranked.getByRole('heading', { name: 'No open actions' })).toBeVisible();
    expect(ranked.getByRole('link', { name: 'View all' })).toHaveAttribute(
      'href',
      '/actions?project=00000000-0000-4000-8000-000000000001',
    );
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
      '/actions/00000000-0000-4000-8000-0000000000d1?project=00000000-0000-4000-8000-000000000001',
    );
    expect(ranked.getByText('/pricing · 3 evidence items')).toBeVisible();
    expect(ranked.getByText('High')).toBeVisible();
    expect(ranked.queryByText('7.5')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No open actions' })).not.toBeInTheDocument();
  });
  it('notes why no run is comparable in one line of the movement card', async () => {
    const user = userEvent.setup();
    queryResult.data = {
      ...commandCenter,
      measurement: {
        ...commandCenter.measurement,
        comparable_audit_id: null,
        comparison_status: 'changed_context',
      },
      movements: [],
    };
    const viewer = renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
      'viewer',
    );
    expect(
      within(screen.getByRole('region', { name: 'Movement' })).getByText(
        'The earlier run used different settings.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Launch run' })).not.toBeInTheDocument();
    viewer.unmount();
    renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
    );
    const movement = within(screen.getByRole('region', { name: 'Movement' }));
    const reason = 'The earlier run used different settings. Launch run to measure movement.';
    expect(movement.getByText(reason)).toBeVisible();
    expect(screen.queryByRole('heading', { name: reason })).not.toBeInTheDocument();
    expect(movement.queryByRole('button', { name: 'Launch run' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Launch run' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Launch run' }));
    expect(screen.getByRole('dialog', { name: 'Launch run' })).toBeInTheDocument();
  });
  it('shows a matched-subset change with its note, and says why per-engine movement is absent', () => {
    queryResult.data = {
      ...commandCenter,
      measurement: {
        ...commandCenter.measurement,
        comparable_audit_id: null,
        comparison_status: 'matched_subset',
        comparison_answers: { matched: 8, total: 12 },
      },
      track: {
        ...commandCenter.track,
        citation_share: { value: 83, delta: 25 },
        limitations: ['8 of 12 answers comparable'],
      },
      movements: [],
    };
    renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
    );
    const state = within(screen.getByRole('region', { name: 'Project state' }));
    expect(state.getByRole('button', { name: 'Basis of Visibility' })).toHaveAccessibleDescription(
      '8 of 12 answers comparable',
    );
    expect(state.getByText('8 of 12 answers comparable')).not.toBeVisible();
    expect(
      state.getByRole('button', { name: 'Basis of Owned citation rate' }),
    ).toHaveAccessibleDescription(/^\d+ engines? · 8 of 12 answers comparable$/);
    expect(state.getByRole('link', { name: 'Owned citation rate' })).toHaveAttribute(
      'href',
      expect.stringContaining('/insights?metric=owned_citation_rate'),
    );
    const movement = within(screen.getByRole('region', { name: 'Movement' }));
    expect(
      movement.getByText(
        '8 of 12 answers comparable; per-engine movement needs a fully comparable run.',
      ),
    ).toBeVisible();
    expect(movement.queryByRole('button', { name: 'Launch run' })).not.toBeInTheDocument();
  });
  it('says a comparable run produced no change, without offering another run', () => {
    queryResult.data = { ...commandCenter, movements: [] };
    renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
    );
    const movement = within(screen.getByRole('region', { name: 'Movement' }));
    expect(movement.getByText('No movement to show')).toBeVisible();
    expect(movement.queryByText(/earlier run/)).not.toBeInTheDocument();
    expect(movement.queryByRole('button', { name: 'Launch run' })).not.toBeInTheDocument();
  });
  it("gives the next Action its reason and the Action's evidence", () => {
    queryResult.data = {
      ...commandCenter,
      next_action: {
        kind: 'opportunity',
        title: 'Publish a comparison page',
        href: '/actions/00000000-0000-4000-8000-0000000000d1',
        opportunity_id: '00000000-0000-4000-8000-0000000000c1',
      },
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
    const next = within(screen.getByRole('region', { name: 'Next action' }));
    expect(next.getByText('Publish a comparison page')).toBeVisible();
    expect(next.getByText('/pricing · 3 evidence items')).toBeVisible();
    expect(next.getByText('High')).toBeVisible();
    expect(next.getByRole('link', { name: 'Open Action' })).toHaveAttribute(
      'href',
      '/actions/00000000-0000-4000-8000-0000000000d1?project=00000000-0000-4000-8000-000000000001',
    );
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
      'crm for agenciesOpen ActionChatGPT API, Gemini API named Globex, Initech',
      'best crm—No Action yetChatGPT API named Globex',
    ]);
    expect(section.getByRole('link', { name: 'Open Action for crm for agencies' })).toHaveAttribute(
      'href',
      '/actions/00000000-0000-4000-8000-0000000000b2?project=00000000-0000-4000-8000-000000000001',
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
  it('keeps Layout and Export PDF behind Page actions at desktop width, Layout for editors only', async () => {
    Object.defineProperty(HTMLElement.prototype, 'checkVisibility', {
      configurable: true,
      value(this: HTMLElement) {
        return !this.closest('[hidden]');
      },
    });
    onTestFinished(() => {
      Reflect.deleteProperty(HTMLElement.prototype, 'checkVisibility');
    });
    const user = userEvent.setup();
    const editor = renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: /manage project/i })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Launch run' })).toBeVisible();
    const menu = await openPageActions(user);
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Layout', 'Export PDF']);
    expect(within(menu).getByRole('menuitem', { name: 'Layout' })).toHaveAttribute(
      'aria-haspopup',
      'menu',
    );
    await user.keyboard('{Escape}');
    editor.unmount();

    renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
      'viewer',
    );
    expect(
      within(await openPageActions(user))
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Export PDF']);
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
    await exportPdf(user);
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
    await exportPdf(user);
    expect(await screen.findByText('The report could not be downloaded. Try again.')).toBeVisible();
    await exportPdf(user);
    await waitFor(() =>
      expect(
        screen.queryByText('The report could not be downloaded. Try again.'),
      ).not.toBeInTheDocument(),
    );
  });
  it('renders facts and a real next action before the first audit', async () => {
    const user = userEvent.setup();
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
    const start = within(screen.getByRole('region', { name: 'Get your first results' }));
    expect(start.getByRole('list', { name: 'Steps to your first results' })).toBeVisible();
    const next = within(start.getByRole('listitem', { current: 'step' }));
    expect(next.getByText('Next')).toBeVisible();
    expect(next.getByRole('button', { name: 'Launch run' })).toBeVisible();
    expect(start.getAllByRole('listitem')[0]).toHaveTextContent('Add prompts, Done');
    expect(screen.getAllByRole('button', { name: 'Launch run' })).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Project state' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Company facts' })).toBeVisible();
    expect(
      within(await openPageActions(user)).getByRole('menuitem', { name: 'Export PDF' }),
    ).toBeVisible();
  });
  it('asks a project with no active prompts to add some', () => {
    queryResult.data = { ...commandCenter, active_prompt_count: 0 };
    renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
    );
    const setup = within(screen.getByRole('region', { name: 'Track prompts again' }));
    expect(setup.getByRole('link', { name: 'Add prompts' })).toHaveAttribute(
      'href',
      '/prompts/build?project=00000000-0000-4000-8000-000000000001',
    );
    expect(screen.getByRole('region', { name: 'Project state' })).toBeVisible();
  });
  it('omits the start card once a run is measured and prompts are tracked', () => {
    renderDashboard(
      <TooltipProvider>
        <DashboardScreen />
      </TooltipProvider>,
    );
    expect(screen.queryByRole('region', { name: 'Track prompts again' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Get your first results' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Project state' })).toBeVisible();
  });
  it('labels a null owned citation rate from an observed run as unavailable', () => {
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
      within(screen.getByRole('region', { name: 'Project state' })).getByText('Unavailable'),
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
    expect(screen.getByText('0.0%')).toBeVisible();
    expect(screen.queryByText('Not measured')).not.toBeInTheDocument();
  });
});
