import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, type RequestHandler } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { queryKeys } from '@/lib/api/query-keys';
import type { BrandProfile } from '@/lib/api/types';
import { makeProject } from '@/test/fixtures/project';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders, testProjectSelection } from '@/test/render';
import { ProjectSelectionProvider } from '@/lib/project/project-scope';

import { ContextScreen } from './context-screen';

const project = makeProject();
const instructionsEndpoint = `/api/v1/projects/${project.id}/agent/instructions`;
const profileEndpoint = `/api/v1/projects/${project.id}/brand-profile`;
const saved = (text: string) => ({ text, revision: 1, created_at: '2026-09-26T10:00:00Z' });
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
      <ContextScreen />
    </ProjectSelectionProvider>
  );
}

/**
 * A project's Context reads: its profile, saved instructions, no suggestions,
 * and outside the fact-checking pilot unless a test says otherwise.
 */
function renderContext({
  profile = emptyProfile,
  activeProject = project,
  tab,
  handlers = [],
}: {
  profile?: BrandProfile;
  activeProject?: ReturnType<typeof makeProject>;
  tab?: string;
  /** Reads that replace the defaults. */
  handlers?: RequestHandler[];
} = {}) {
  mswServer.use(
    http.get(instructionsEndpoint, () => HttpResponse.json(saved('Original'))),
    http.get('/api/v1/projects/:id/brand-profile', () => HttpResponse.json(profile)),
    http.get('/api/v1/projects/:id/competitor-suggestions', () => HttpResponse.json([])),
    http.get('/api/v1/projects/:id/brand-facts', () =>
      HttpResponse.json({ enabled: false, facts: [] }),
    ),
  );
  mswServer.use(...handlers);
  if (tab) window.history.replaceState(null, '', `/agent/context?tab=${tab}`);
  return renderWithProviders(<ContextScope activeProject={activeProject} />);
}

/** Records the body of the next profile save and answers with `reply`. */
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
    ).toEqual([
      'Company',
      'Audience & Offerings',
      'Business map',
      'Competitors',
      'Agent instructions',
    ]);
    // The instructions are a tab of their own, not a section under every tab.
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

  it('offers the save that belongs to the active tab, and none on a read-only tab', async () => {
    const user = userEvent.setup({ delay: null });
    mswServer.use(
      http.get(`/api/v1/projects/${project.id}/business-map`, () =>
        HttpResponse.json({ available_offerings: [], offerings: [] }),
      ),
    );
    renderContext();
    expect(await screen.findByRole('button', { name: 'Save brand knowledge' })).toBeEnabled();
    await user.click(screen.getByRole('tab', { name: 'Business map' }));
    expect(screen.queryByRole('button', { name: /^save/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Agent instructions' }));
    expect(await screen.findByRole('button', { name: 'Save instructions' })).toBeDisabled();
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
  it('saves direct edits, keeping drafts across tabs and a typed but unadded offering', async () => {
    const user = userEvent.setup({ delay: null });
    const save = captureProfileSave(() =>
      HttpResponse.json({ ...emptyProfile, description: 'A value-focused family retailer.' }),
    );
    renderContext();
    await user.type(
      await screen.findByLabelText('Description'),
      'A value-focused family retailer.',
    );
    await user.click(screen.getByRole('tab', { name: 'Audience & Offerings' }));
    await user.type(screen.getByLabelText('Add to Products and services'), 'Clothing');
    await user.click(screen.getByRole('tab', { name: 'Company' }));
    expect(screen.getByLabelText('Description')).toHaveValue('A value-focused family retailer.');
    await user.click(screen.getByRole('button', { name: 'Save brand knowledge' }));

    expect(await screen.findByText(/brand knowledge saved/i)).toBeInTheDocument();
    expect(save.body).toEqual({
      description: 'A value-focused family retailer.',
      products_services: ['Clothing'],
    });
  });

  it('keeps an offering containing a comma as one chip through a save', async () => {
    const user = userEvent.setup({ delay: null });
    const bays = 'Commercial simulator bays for golf courses, and community centers';
    const save = captureProfileSave(() =>
      HttpResponse.json({
        ...emptyProfile,
        products_services: [bays, 'Golf nets, cages and mats'],
      }),
    );
    renderContext({ profile: { ...emptyProfile, products_services: [bays] }, tab: 'audience' });
    const field = await screen.findByLabelText('Add to Products and services');
    await user.type(field, 'Golf nets, cages and mats{Enter}');
    // A duplicate, in any case, cannot be added twice.
    await user.type(field, 'golf NETS, cages and mats');
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    await user.clear(field);
    await user.click(screen.getByRole('button', { name: 'Save brand knowledge' }));

    expect(await screen.findByText(/brand knowledge saved/i)).toBeInTheDocument();
    expect(save.body).toEqual({ products_services: [bays, 'Golf nets, cages and mats'] });
    const list = screen.getByRole('list', { name: 'Products and services' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([bays, 'Golf nets, cages and mats']);
  });

  it('removes an offering chip from the saved list', async () => {
    const user = userEvent.setup({ delay: null });
    const save = captureProfileSave(() =>
      HttpResponse.json({ ...emptyProfile, products_services: ['Golf mats'] }),
    );
    renderContext({
      profile: { ...emptyProfile, products_services: ['Golf nets', 'Golf mats'] },
      tab: 'audience',
    });
    await user.click(await screen.findByRole('button', { name: 'Remove Golf nets' }));
    await user.click(screen.getByRole('button', { name: 'Save brand knowledge' }));
    await waitFor(() => expect(save.body).toEqual({ products_services: ['Golf mats'] }));
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
    const category = await screen.findByLabelText(/what you sell/i);
    expect(category).toHaveValue('feed software');
    expect(screen.getByRole('radio', { name: 'Businesses' })).toBeChecked();
    await user.clear(category);
    await user.type(category, 'product feed management platform');
    await user.click(screen.getByRole('radio', { name: 'Worldwide' }));
    await user.click(screen.getByRole('button', { name: 'Save brand knowledge' }));
    // Untouched facets and fields are not resubmitted, so they are not marked reviewed.
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
    await user.clear(await screen.findByLabelText(/what you sell/i));
    await user.click(screen.getByRole('button', { name: 'Save brand knowledge' }));

    expect(await screen.findByText('category is required')).toBeVisible();
    expect(save.body).toEqual({ category: '' });
    expect(screen.getByLabelText(/what you sell/i)).toHaveValue('');
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
  it('lists tracked competitors as marked chips, adds a suggestion and opens their editor', async () => {
    const user = userEvent.setup({ delay: null });
    let accepted: string | undefined;
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
    const handlers = [
      http.get('/api/v1/projects/:id/competitor-suggestions', () =>
        HttpResponse.json([
          {
            id: '66666666-6666-4666-8666-666666666666',
            audit_id: '77777777-7777-4777-8777-777777777777',
            name: 'Globex',
            domain: 'globex.test',
            qualification_reason: 'Repeated third-party citations',
            prompt_count: 3,
            engine_count: 2,
            market_relevant: true,
            analyzer_version: 'competitor-v1',
            source_analysis_ids: [],
            source_artifact_ids: [],
            status: 'candidate',
            created_at: '2026-11-01T00:00:00Z',
          },
        ]),
      ),
      http.post('/api/v1/projects/:id/competitor-suggestions/:candidate/accept', ({ params }) => {
        accepted = String(params.candidate);
        return HttpResponse.json({
          id: '88888888-8888-4888-8888-888888888883',
          name: 'Globex',
          aliases: [],
          domains: ['globex.test'],
        });
      }),
    ];
    renderContext({ activeProject: withCompetitors, tab: 'competitors', handlers });

    const tracked = await screen.findByRole('list', { name: 'Tracked competitors' });
    // Contoso has no cached logo, so its mark falls back to its initials.
    expect(
      within(tracked)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Northstar', 'COContoso']);
    expect(within(tracked).getAllByRole('listitem')[0]?.querySelector('img')).toHaveAttribute(
      'src',
      'https://assets.test/northstar.png',
    );

    await user.click(await screen.findByRole('button', { name: 'Add competitor' }));
    await waitFor(() => expect(accepted).toBe('66666666-6666-4666-8666-666666666666'));

    await user.click(screen.getByRole('button', { name: 'Edit competitors' }));
    expect(await screen.findByRole('dialog', { name: 'Edit Acme' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove Northstar' })).toBeEnabled();
  });
});

describe('Business map', () => {
  it('shows the map read-only as chips, marking suggestions, linked to the Prompt Builder', async () => {
    const offering = 'Golf practice net';
    mswServer.use(
      http.get(`/api/v1/projects/${project.id}/business-map`, () =>
        HttpResponse.json({
          available_offerings: [offering],
          offerings: [
            {
              offering,
              attributes: [],
              situations: [
                {
                  value: 'Small garden',
                  origin: 'model',
                  review_state: 'suggested',
                  reviewed_by: null,
                  reviewed_at: null,
                  source: {},
                },
              ],
              audiences: [],
              exclusions: [],
            },
          ],
        }),
      ),
    );
    renderContext({
      profile: {
        ...emptyProfile,
        products_services: [offering],
        business_context: {
          buyer_roles: ['Club coach', 'Parent'],
          business_model: 'd2c_product',
          // Discovery inferred the roles; a person has saved the business model.
          field_sources: { buyer_roles: 'inferred', business_model: 'reviewed' },
        },
      },
      tab: 'map',
    });

    const details = await screen.findByLabelText('Business details');
    const [roles] = within(details).getAllByRole('list');
    if (!roles) throw new Error('Buyer roles render as a list');
    expect(
      within(roles)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Club coachSuggested', 'ParentSuggested']);
    expect(details).toHaveTextContent('Business modelProducts sold direct');
    expect(details).not.toHaveTextContent('Products sold directSuggested');
    expect(screen.getByRole('region', { name: offering })).toHaveTextContent(
      'Situations and constraintsSmall gardenSuggested',
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit in Prompt Builder' })).toHaveAttribute(
      'href',
      expect.stringContaining('/prompts?generate=1'),
    );
  });

  it('tells an unrecognized saved business model apart from none', async () => {
    mswServer.use(
      http.get(`/api/v1/projects/${project.id}/business-map`, () =>
        HttpResponse.json({ available_offerings: [], offerings: [] }),
      ),
    );
    const view = renderContext({
      profile: { ...emptyProfile, business_context: { business_model: 'franchise' } },
      tab: 'map',
    });
    expect(await screen.findByLabelText('Business details')).toHaveTextContent(
      'Business modelUnknown',
    );
    view.unmount();

    renderContext({ tab: 'map' });
    expect(await screen.findByLabelText('Business details')).toHaveTextContent(
      'Business modelNot set',
    );
  });
});

describe('Agent instruction drafts', () => {
  it('resets a draft when the active project changes', async () => {
    const nextProject = makeProject({ id: '11111111-1111-4111-8111-111111111112' });
    const { rerender } = renderContext({ tab: 'instructions' });
    mswServer.use(
      http.get(`/api/v1/projects/${nextProject.id}/agent/instructions`, () =>
        HttpResponse.json(saved('Second project')),
      ),
    );
    const field = await screen.findByRole('textbox', { name: 'Agent instructions' });
    fireEvent.change(field, { target: { value: 'Unsaved first-project draft' } });
    rerender(<ContextScope activeProject={nextProject} />);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Agent instructions' })).toHaveValue(
        'Second project',
      ),
    );
  });

  it('follows refreshed instructions until edited, then preserves the local draft', async () => {
    const { queryClient } = renderContext({ tab: 'instructions' });
    const field = await screen.findByRole('textbox', { name: 'Agent instructions' });
    act(() =>
      queryClient.setQueryData(queryKeys.agent.instructions(project.id), saved('Refreshed')),
    );
    await waitFor(() => expect(field).toHaveValue('Refreshed'));
    fireEvent.change(field, { target: { value: 'Local draft' } });
    act(() =>
      queryClient.setQueryData(queryKeys.agent.instructions(project.id), saved('Remote edit')),
    );
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
    await user.click(screen.getByRole('tab', { name: 'Agent instructions' }));
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
        expect(queryClient.getQueryData(queryKeys.agent.instructions(project.id))).toEqual(
          saved('Submitted'),
        ),
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
        HttpResponse.json({ enabled: false, facts: [] }),
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
        <ContextScreen />
      </ProjectSelectionProvider>,
    );
    expect(await screen.findByRole('textbox', { name: 'Agent instructions' })).toHaveAttribute(
      'readonly',
    );
    expect(screen.queryByRole('button', { name: /^save/i })).not.toBeInTheDocument();
  });
});
