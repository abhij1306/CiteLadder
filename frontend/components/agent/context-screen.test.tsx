import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, type RequestHandler } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { queryKeys } from '@/lib/api/query-keys';
import type { BrandProfile, BusinessMap } from '@citeladder/contracts';
import { makeProject } from '@/test/fixtures/project';
import { makeSetList } from '@/test/fixtures/prompts';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders, testProjectSelection } from '@/test/render';
import { ActiveProjectScopeProvider } from '@/lib/project/active-project-scope';
import { ProjectSelectionProvider } from '@/lib/project/project-scope';

import { ContextScreen } from './context-screen';

const project = makeProject();
const instructionsEndpoint = `/api/v1/projects/${project.id}/agent/instructions`;
const profileEndpoint = `/api/v1/projects/${project.id}/brand-profile`;
const limits = { statement_max_chars: 300, facts_import_max_rows: 150 };
const saved = (text: string) => ({ text, revision: 1, created_at: '2026-09-26T10:00:00Z' });
const instructionsKey = queryKeys.agent.instructions({
  workspaceId: testProjectSelection().activeWorkspaceId,
  projectId: project.id,
});
const none = {
  description: null,
  positioning: null,
  products_services: null,
  target_audience: null,
};
const emptyProfile: BrandProfile = {
  id: '22222222-2222-4222-8222-222222222222',
  workspace_id: '33333333-3333-4333-8333-333333333333',
  project_id: project.id,
  brand_id: '44444444-4444-4444-8444-444444444444',
  description: '',
  positioning: '',
  products_services: [],
  target_audience: '',
  business_context: {},
  sources: none,
  source_artifact_ids: none,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  mswServer.resetHandlers();
  window.history.replaceState(null, '', '/');
});
afterAll(() => mswServer.close());

function ContextScope({ activeProject }: { activeProject: ReturnType<typeof makeProject> }) {
  return (
    <ProjectSelectionProvider
      value={testProjectSelection({
        activeProject,
        activeProjectId: activeProject.id,
        status: 'ready',
      })}
    >
      <ActiveProjectScopeProvider project={activeProject}>
        <ContextScreen />
      </ActiveProjectScopeProvider>
    </ProjectSelectionProvider>
  );
}

function renderContext({
  profile = emptyProfile,
  activeProject = project,
  tab,
  handlers = [],
}: {
  profile?: BrandProfile;
  activeProject?: ReturnType<typeof makeProject>;
  tab?: string;
  handlers?: RequestHandler[];
} = {}) {
  mswServer.use(
    http.get(instructionsEndpoint, () => HttpResponse.json(saved('Original'))),
    http.get('/api/v1/projects/:id/brand-profile', () => HttpResponse.json(profile)),
    http.get('/api/v1/projects/:id/brand-facts', () =>
      HttpResponse.json({ enabled: false, facts: [], limits }),
    ),
  );
  mswServer.use(...handlers);
  if (tab) window.history.replaceState(null, '', `/agent/context?tab=${tab}`);
  return renderWithProviders(<ContextScope activeProject={activeProject} />);
}

function mapReads(map: BusinessMap = { available_offerings: [], offerings: [] }) {
  return [
    http.get(`/api/v1/projects/${project.id}/business-map`, () => HttpResponse.json(map)),
    http.get('/api/v1/prompt-sets', () => HttpResponse.json(makeSetList([]))),
  ];
}

function captureProfileSave(reply: (body: unknown) => Response) {
  const capture: { body?: unknown } = {};
  mswServer.use(
    http.put(profileEndpoint, async ({ request }) => {
      capture.body = await request.json();
      return reply(capture.body);
    }),
  );
  return capture;
}

describe('Context layout', () => {
  it('puts every subject, Agent instructions included, on one tab row', async () => {
    renderContext();
    const tabs = await screen.findByRole('tablist', { name: 'Context sections' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Company', 'Themes', 'Business map', 'Competitors', 'Instructions', 'Brand facts']);
    expect(screen.queryByRole('textbox', { name: 'Agent instructions' })).not.toBeInTheDocument();
  });

  it('opens the tab named in the address and records the tab it switches to', async () => {
    const user = userEvent.setup({ delay: null });
    renderContext({ tab: 'instructions' });
    expect(await screen.findByRole('textbox', { name: 'Agent instructions' })).toHaveValue(
      'Original',
    );
    await user.click(screen.getByRole('tab', { name: 'Competitors' }));
    expect(window.location.search).toBe('?tab=competitors');
  });

  it('offers the save that belongs to the active tab', async () => {
    const user = userEvent.setup({ delay: null });
    renderContext({ handlers: mapReads() });
    const idle = await screen.findByRole('button', { name: 'Save brand knowledge' });
    expect(idle).toHaveAttribute('aria-disabled', 'true');
    expect(idle).toHaveAccessibleDescription('No changes to save');
    await user.type(screen.getByLabelText('Description'), 'Coffee');
    const save = screen.getByRole('button', { name: 'Save brand knowledge' });
    expect(save).toBeEnabled();
    expect(save).not.toHaveAttribute('aria-disabled');
    expect(save).not.toHaveAccessibleDescription('No changes to save');
    await user.click(screen.getByRole('tab', { name: 'Business map' }));
    expect(await screen.findByRole('button', { name: 'Save business map' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.queryByRole('button', { name: 'Save brand knowledge' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Instructions' }));
    const idleInstructions = await screen.findByRole('button', { name: 'Save instructions' });
    expect(idleInstructions).toHaveAttribute('aria-disabled', 'true');
    expect(idleInstructions).toHaveAccessibleDescription('No changes to save');
  });

  it('shows the Brand facts tab with its error when the pilot gate cannot be read', async () => {
    const user = userEvent.setup({ delay: null });
    renderContext({
      handlers: [
        http.get('/api/v1/projects/:id/brand-facts', () =>
          HttpResponse.json(
            { error: { message: 'The fact-checking pilot is unavailable.' } },
            { status: 404 },
          ),
        ),
      ],
    });
    await user.click(await screen.findByRole('tab', { name: 'Brand facts' }));
    expect(await screen.findByText('The fact-checking pilot is unavailable.')).toBeVisible();
  });

  it('offers Brand facts with its aliases before the pilot gate answers', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    renderContext({
      tab: 'brand-facts',
      activeProject: makeProject({
        brand: { alias_suggestions: [], aliases: ['Best&Less'], logo_url: null },
      }),
      handlers: [
        http.get('/api/v1/projects/:id/brand-facts', async () => {
          await gate;
          return HttpResponse.json({ enabled: true, facts: [], limits });
        }),
      ],
    });
    const tabs = await screen.findByRole('tablist', { name: 'Context sections' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Company', 'Themes', 'Business map', 'Competitors', 'Instructions', 'Brand facts']);
    const aliases = screen.getByRole('group', { name: 'Aliases' });
    expect(within(aliases).getByText('Best&Less')).toBeVisible();
    expect(await screen.findByRole('status', { name: 'Loading brand facts…' })).toBeVisible();
    release();
    expect(await screen.findByText(/No facts yet/)).toBeVisible();
  });

  it('keeps the aliases and hides the facts outside the pilot', async () => {
    renderContext({
      tab: 'brand-facts',
      activeProject: makeProject({
        brand: { alias_suggestions: [], aliases: ['Best&Less'], logo_url: null },
      }),
    });
    expect(await screen.findByText('Best&Less')).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Loading brand facts…' })).toBeNull(),
    );
    expect(screen.queryByRole('heading', { name: 'Brand facts' })).not.toBeInTheDocument();
  });

  it('keeps pilot Brand facts on their own tab', async () => {
    const user = userEvent.setup({ delay: null });
    renderContext({
      handlers: [
        http.get('/api/v1/projects/:id/brand-facts', () =>
          HttpResponse.json({
            enabled: true,
            facts: [
              {
                id: '55555555-5555-4555-8555-555555555556',
                topic: 'pricing',
                statement: 'Pro costs $59 per month.',
                source_url: null,
                status: 'confirmed',
                revision: 1,
                updated_at: '2026-11-01T00:00:00Z',
              },
            ],
            limits,
          }),
        ),
      ],
    });
    const facts = await screen.findByRole('tab', { name: 'Brand facts' });
    expect(screen.queryByText('Pro costs $59 per month.')).not.toBeInTheDocument();
    await user.click(facts);
    expect(screen.getByText('Pro costs $59 per month.')).toBeVisible();
  });
});

describe('Company facts', () => {
  it('saves direct edits, keeping drafts across tabs', async () => {
    const user = userEvent.setup({ delay: null });
    const save = captureProfileSave(() =>
      HttpResponse.json({ ...emptyProfile, description: 'A value-focused family retailer.' }),
    );
    renderContext();
    await user.type(
      await screen.findByLabelText('Description'),
      'A value-focused family retailer.',
    );
    await user.type(screen.getByLabelText('Target audience'), 'Families');
    await user.click(screen.getByRole('tab', { name: 'Competitors' }));
    await user.click(screen.getByRole('tab', { name: 'Company' }));
    expect(screen.getByLabelText('Description')).toHaveValue('A value-focused family retailer.');
    await user.click(screen.getByRole('button', { name: 'Save brand knowledge' }));

    expect(await screen.findByText(/brand knowledge saved/i)).toBeInTheDocument();
    expect(save.body).toEqual({
      description: 'A value-focused family retailer.',
      target_audience: 'Families',
    });
  });

  it('sends only the category, buyer and market a reader changed', async () => {
    const user = userEvent.setup({ delay: null });
    const save = captureProfileSave(() => HttpResponse.json(emptyProfile));
    renderContext({
      profile: {
        ...emptyProfile,
        business_context: { category: 'feed software', buyer_type: 'b2b' },
      },
    });
    const category = await screen.findByLabelText('Category');
    expect(category).toHaveValue('feed software');
    expect(screen.getByLabelText('Who buys it')).toHaveTextContent('Businesses');
    await user.clear(category);
    await user.type(category, 'product feed management platform');
    await user.click(screen.getByLabelText('Where they buy it'));
    await user.click(screen.getByRole('option', { name: 'Worldwide' }));
    await user.click(screen.getByRole('button', { name: 'Save brand knowledge' }));
    await waitFor(() =>
      expect(save.body).toEqual({
        category: 'product feed management platform',
        market_scope: 'global',
      }),
    );
  });

  it('sends a cleared category so the save fails instead of silently reverting', async () => {
    const user = userEvent.setup({ delay: null });
    const save = captureProfileSave(() =>
      HttpResponse.json({ error: { message: 'category is required' } }, { status: 422 }),
    );
    renderContext({
      profile: { ...emptyProfile, business_context: { category: 'feed software' } },
    });
    await user.clear(await screen.findByLabelText('Category'));
    await user.click(screen.getByRole('button', { name: 'Save brand knowledge' }));

    expect(await screen.findByText('category is required')).toBeVisible();
    expect(save.body).toEqual({ category: '' });
    expect(screen.getByLabelText('Category')).toHaveValue('');
  });

  it('locks profile fields while a save is pending', async () => {
    const user = userEvent.setup({ delay: null });
    let finishSave: (() => void) | undefined;
    mswServer.use(
      http.put(profileEndpoint, async () => {
        await new Promise<void>((resolve) => {
          finishSave = resolve;
        });
        return HttpResponse.json({ ...emptyProfile, description: 'Submitted description.' });
      }),
    );
    renderContext();
    const description = await screen.findByLabelText('Description');
    await user.type(description, 'Submitted description.');
    await user.click(screen.getByRole('button', { name: 'Save brand knowledge' }));

    await waitFor(() => expect(description).toBeDisabled());
    expect(screen.getByLabelText('Positioning')).toBeDisabled();
    finishSave?.();
    expect(await screen.findByText(/brand knowledge saved/i)).toBeInTheDocument();
    expect(description).toHaveValue('Submitted description.');
  });
});

describe('Competitors', () => {
  it('lists tracked competitors one row each and opens their editor', async () => {
    const user = userEvent.setup({ delay: null });
    const withCompetitors = makeProject({
      competitors: [
        {
          id: '88888888-8888-4888-8888-888888888881',
          name: 'Northstar',
          aliases: [],
          domains: [],
          logo_url: 'https://assets.test/northstar.png',
        },
        {
          id: '88888888-8888-4888-8888-888888888882',
          name: 'Contoso',
          aliases: [],
          domains: ['contoso.test'],
          logo_url: null,
        },
      ],
    });
    renderContext({ activeProject: withCompetitors, tab: 'competitors' });

    const tracked = await screen.findByRole('group', { name: 'Tracked competitors' });
    const rows = [...tracked.querySelectorAll('[data-setting-row]')];
    expect(rows.map((row) => row.textContent)).toEqual([
      'Northstar—Not set',
      'CContosocontoso.test',
    ]);
    expect(rows[0]?.querySelector('img')).toHaveAttribute(
      'src',
      'https://assets.test/northstar.png',
    );

    await user.click(screen.getByRole('button', { name: 'Edit competitors' }));
    expect(await screen.findByRole('dialog', { name: 'Edit Acme' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove Northstar' })).toBeEnabled();
  });
});

describe('Business map', () => {
  const offering = 'Golf practice net';
  const suggested = {
    value: 'Small garden',
    origin: 'model' as const,
    review_state: 'suggested' as const,
    reviewed_by: null,
    reviewed_at: null,
    source: {},
  };
  const golfMap: BusinessMap = {
    available_offerings: [offering],
    offerings: [
      { offering, attributes: [], situations: [suggested], audiences: [], exclusions: [] },
    ],
  };
  const golfProfile: BrandProfile = {
    ...emptyProfile,
    products_services: [offering],
    business_context: {
      buyer_roles: ['Club coach', 'Parent'],
      business_model: 'd2c_product',
      field_sources: { buyer_roles: 'inferred', business_model: 'reviewed' },
    },
  };

  it('edits the map in place and saves accepted suggestions through the profile and map owners', async () => {
    const user = userEvent.setup({ delay: null });
    const profileSave = captureProfileSave(() => HttpResponse.json(golfProfile));
    const mapSave: { body?: unknown } = {};
    mswServer.use(
      http.put(`/api/v1/projects/${project.id}/business-map`, async ({ request }) => {
        mapSave.body = await request.json();
        return HttpResponse.json(golfMap);
      }),
    );
    renderContext({ profile: golfProfile, tab: 'map', handlers: mapReads(golfMap) });

    expect(await screen.findByText('3 suggestions')).toBeVisible();
    expect(
      within(screen.getByRole('list', { name: `Situations: ${offering}` })).getByRole('listitem'),
    ).toHaveTextContent('Small garden (suggested)');
    expect(screen.getByRole('combobox', { name: 'Business model' })).toHaveTextContent(
      'Products sold direct',
    );

    const add = screen.getByRole('textbox', { name: 'Add offering' });
    await user.type(add, 'Nets, cages and mats{Enter}');
    await user.type(add, 'golf PRACTICE net{Enter}');
    expect(
      within(screen.getByRole('list', { name: 'Offerings' }))
        .getAllByRole('listitem', { name: /./ })
        .map((row) => row.getAttribute('aria-label')),
    ).toEqual([offering, 'Nets, cages and mats']);

    await user.click(screen.getByRole('button', { name: 'Accept all' }));
    expect(screen.queryByText(/suggestions?$/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save business map' }));

    await waitFor(() =>
      expect(mapSave.body).toEqual({
        offerings: [
          {
            offering,
            attributes: [],
            situations: [{ value: 'Small garden', review_state: 'confirmed' }],
            audiences: [],
            exclusions: [],
          },
          {
            offering: 'Nets, cages and mats',
            attributes: [],
            situations: [],
            audiences: [],
            exclusions: [],
          },
        ],
      }),
    );
    expect(profileSave.body).toEqual({
      products_services: [offering, 'Nets, cages and mats'],
      buyer_roles: ['Club coach', 'Parent'],
    });
  });

  it('keeps unsaved map edits across tab switches', async () => {
    const user = userEvent.setup({ delay: null });
    renderContext({ profile: golfProfile, tab: 'map', handlers: mapReads(golfMap) });
    await user.type(
      await screen.findByRole('textbox', { name: 'Add offering' }),
      'Hitting mats{Enter}',
    );
    await user.click(screen.getByRole('tab', { name: 'Competitors' }));
    await user.click(screen.getByRole('tab', { name: 'Business map' }));
    expect(await screen.findByRole('listitem', { name: 'Hitting mats' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save business map' })).not.toHaveAttribute(
      'aria-disabled',
    );
  });

  it('tells an unrecognized saved business model apart from none', async () => {
    const view = renderContext({
      profile: { ...emptyProfile, business_context: { business_model: 'franchise' } },
      tab: 'map',
      handlers: mapReads(),
    });
    expect(await screen.findByRole('combobox', { name: 'Business model' })).toHaveTextContent(
      'Unknown',
    );
    view.unmount();

    renderContext({ tab: 'map', handlers: mapReads() });
    expect(await screen.findByRole('combobox', { name: 'Business model' })).toHaveTextContent(
      'Not set',
    );
    expect(screen.queryByRole('button', { name: 'Accept all' })).not.toBeInTheDocument();
  });
});

describe('Agent instruction drafts', () => {
  it('follows refreshed instructions until edited, then preserves the local draft', async () => {
    const { queryClient } = renderContext({ tab: 'instructions' });
    const field = await screen.findByRole('textbox', { name: 'Agent instructions' });
    act(() => queryClient.setQueryData(instructionsKey, saved('Refreshed')));
    await waitFor(() => expect(field).toHaveValue('Refreshed'));
    fireEvent.change(field, { target: { value: 'Local draft' } });
    act(() => queryClient.setQueryData(instructionsKey, saved('Remote edit')));
    await waitFor(() => expect(field).toHaveValue('Local draft'));
    fireEvent.change(field, { target: { value: 'Original' } });
    expect(field).toHaveValue('Original');
    expect(screen.getByRole('button', { name: 'Save instructions' })).toBeEnabled();
  });

  it('keeps a draft across tab switches', async () => {
    const user = userEvent.setup({ delay: null });
    renderContext({ tab: 'instructions' });
    fireEvent.change(await screen.findByRole('textbox', { name: 'Agent instructions' }), {
      target: { value: 'Plain, warm tone.' },
    });
    await user.click(screen.getByRole('tab', { name: 'Competitors' }));
    await user.click(screen.getByRole('tab', { name: 'Instructions' }));
    expect(screen.getByRole('textbox', { name: 'Agent instructions' })).toHaveValue(
      'Plain, warm tone.',
    );
  });

  it.each(['Later typing', 'Original'])(
    'preserves %s entered while a save is pending',
    async (later) => {
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { queryClient } = renderContext({ tab: 'instructions' });
      mswServer.use(
        http.put(instructionsEndpoint, async () => {
          await pending;
          return HttpResponse.json(saved('Submitted'));
        }),
      );
      const field = await screen.findByRole('textbox', { name: 'Agent instructions' });
      fireEvent.change(field, { target: { value: 'Submitted' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save instructions' }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Save instructions' })).toBeDisabled(),
      );
      fireEvent.change(field, { target: { value: later } });
      release();
      await waitFor(() =>
        expect(queryClient.getQueryData(instructionsKey)).toEqual(saved('Submitted')),
      );
      expect(field).toHaveValue(later);
      expect(screen.getByRole('button', { name: 'Save instructions' })).toBeEnabled();
    },
  );

  it('is read-only, with no save, for a member who cannot run the agent', async () => {
    mswServer.use(
      http.get(instructionsEndpoint, () => HttpResponse.json(saved('Original'))),
      http.get('/api/v1/projects/:id/brand-profile', () => HttpResponse.json(emptyProfile)),
      http.get('/api/v1/projects/:id/competitor-suggestions', () => HttpResponse.json([])),
      http.get('/api/v1/projects/:id/brand-facts', () =>
        HttpResponse.json({ enabled: false, facts: [], limits }),
      ),
    );
    window.history.replaceState(null, '', '/agent/context?tab=instructions');
    const { activeWorkspace } = testProjectSelection();
    if (!activeWorkspace) throw new Error('The harness resolves a workspace');
    const viewer = { ...activeWorkspace, role: 'viewer' as const, capabilities: ['read'] };
    renderWithProviders(
      <ProjectSelectionProvider
        value={testProjectSelection({
          activeProject: project,
          activeProjectId: project.id,
          status: 'ready',
          workspaces: [viewer],
          activeWorkspace: viewer,
        })}
      >
        <ActiveProjectScopeProvider project={project}>
          <ContextScreen />
        </ActiveProjectScopeProvider>
      </ProjectSelectionProvider>,
    );
    expect(await screen.findByRole('textbox', { name: 'Agent instructions' })).toHaveAttribute(
      'readonly',
    );
    expect(screen.queryByRole('button', { name: /^save/i })).not.toBeInTheDocument();
  });
});
