import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import { makeProject } from '@/test/fixtures/project';
import { makePrompt, makeSet, makeSetList } from '@/test/fixtures/prompts';
import { mswServer } from '@/test/msw-server';
import { ToastProvider } from '@/components/ui/toast';
import { chooseFilterOption, openFilterRow } from '@/test/all-filters';
import { renderWithProviders, selectionAs } from '@/test/render';

import { PromptLibrary } from './prompt-library';

const prompt = makePrompt({ text: 'Best running shoes for flat feet?' });
const set = makeSet([prompt]);
const project = makeProject({ prompt_sets: [set] });

function metric(visibilityRate: number) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    audit_id: '55555555-5555-4555-8555-555555555555',
    prompt_id: prompt.id,
    prompt_index: 0,
    prompt_text: prompt.text,
    cohort: 'core',
    composite_score: null,
    previous_score: null,
    immediate_delta: null,
    rolling_four: [],
    per_engine_scores: {},
    components: {},
    engine_agreement: 1,
    repetition_agreement: 1,
    evidence_coverage: 1,
    trend_confidence: 1,
    decline_confirmed: false,
    analyzer_version: 'v1',
    scoring_rule_version: 'v1',
    created_at: '2026-11-01T00:00:00Z',
    visibility_rate: visibilityRate,
    owned_citation_rate: null,
    avg_position: null,
    visibility_delta: null,
    mentions: 0,
    brands: [],
  };
}

function libraryReads(figures: () => Promise<Response>) {
  mswServer.use(
    http.get('/api/v1/prompt-sets', () => HttpResponse.json(makeSetList([set]))),
    http.get(`/api/v1/prompt-sets/${set.id}/candidates`, () => HttpResponse.json([])),
    http.get(`/api/v1/projects/${project.id}/topics`, () => HttpResponse.json([])),
    http.get(`/api/v1/projects/${project.id}/visibility/prompts`, ({ request }) =>
      new URL(request.url).searchParams.get('latest') === 'prompt'
        ? figures()
        : HttpResponse.json({ error: { message: 'latest run alone' } }, { status: 400 }),
    ),
  );
}

function renderLibrary() {
  return renderWithProviders(<PromptLibrary />, {
    projectSelection: {
      projects: [project],
      activeProject: project,
      activeProjectId: project.id,
      status: 'ready',
    },
  });
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('PromptLibrary first load', () => {
  it("holds the prompt rows until the latest run's figures land, then draws them with their measured columns", async () => {
    const figures: { answer?: (response: Response) => void } = {};
    libraryReads(
      () =>
        new Promise<Response>((resolve) => {
          figures.answer = resolve;
        }),
    );

    renderLibrary();

    const answer = await vi.waitFor(() => {
      if (!figures.answer) throw new Error('The figures were not requested yet.');
      return figures.answer;
    });
    expect(screen.queryByText(prompt.text)).not.toBeInTheDocument();

    answer(HttpResponse.json([metric(0.5)]));

    const table = await screen.findByRole('table', { name: 'Prompts' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((head) => head.textContent),
    ).toEqual([
      '',
      'Prompt',
      'Topic',
      'Visibility',
      'Change',
      expect.stringMatching(/^Mentions/),
      expect.stringMatching(/^Citations/),
      expect.stringMatching(/^Sources/),
      expect.stringMatching(/^Position/),
      expect.stringMatching(/^Share of voice/),
      expect.stringMatching(/^Sentiment/),
      'Actions',
    ]);
    const row = within(table).getByRole('row', { name: new RegExp(prompt.text.slice(0, 20)) });
    expect(within(row).getByText('50.0%')).toBeVisible();
  });

  it("opens a measured prompt's evidence on the latest run's succeeded answer", async () => {
    const run = metric(0.5).audit_id;
    const execution = (id: string, promptIndex: number, status: string) => ({
      id,
      prompt_index: promptIndex,
      logical_engine: 'chatgpt',
      transport_provider: 'openai',
      status,
      prompt_text: prompt.text,
      error_code: '',
      latency_ms: 1,
    });
    const ANSWER = '66666666-6666-4666-8666-666666666663';
    const read: string[] = [];
    libraryReads(async () => HttpResponse.json([metric(0.5)]));
    mswServer.use(
      http.get(`/api/v1/audits/${run}/executions`, () =>
        HttpResponse.json([
          execution('66666666-6666-4666-8666-666666666661', 1, 'succeeded'),
          execution('66666666-6666-4666-8666-666666666662', 0, 'failed'),
          execution(ANSWER, 0, 'succeeded'),
        ]),
      ),
      http.get('/api/v1/executions/:id', ({ params }) => {
        read.push(String(params.id));
        return HttpResponse.json({ detail: 'Gone.', code: 'not_found' }, { status: 404 });
      }),
    );
    const user = userEvent.setup();
    renderLibrary();

    await user.click(await screen.findByRole('link', { name: prompt.text }));

    expect(await screen.findByRole('dialog', { name: prompt.text })).toBeVisible();
    await waitFor(() => expect(read).toContain(ANSWER));
    expect(new Set(read)).toEqual(new Set([ANSWER]));
  });

  it("says the figures read failed rather than drawing 'no run', and retries it", async () => {
    let fail = true;
    libraryReads(async () =>
      fail
        ? HttpResponse.json({ detail: 'Down.', code: 'unavailable' }, { status: 503 })
        : HttpResponse.json([metric(0.5)]),
    );
    const user = userEvent.setup();
    renderLibrary();

    const table = await screen.findByRole('table', { name: 'Prompts' });
    expect(within(table).getByText(prompt.text)).toBeVisible();
    expect(screen.getByText("Couldn't load the prompts' latest figures")).toBeVisible();

    fail = false;
    await user.click(screen.getByRole('button', { name: /Retry/ }));
    const row = await within(table).findByRole('row', {
      name: new RegExp(prompt.text.slice(0, 20)),
    });
    expect(await within(row).findByText('50.0%')).toBeVisible();
    expect(screen.queryByText("Couldn't load the prompts' latest figures")).toBeNull();
  });
});

describe('PromptLibrary paging', () => {
  it('opens the first page when a search narrows the list', async () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      makePrompt({
        id: `66666666-6666-4666-8666-6666666667${String(index).padStart(2, '0')}`,
        text: index === 0 ? 'Best trail boots?' : `Best road shoes ${index}?`,
      }),
    );
    const pagedSet = makeSet(many);
    const pagedProject = makeProject({ prompt_sets: [pagedSet] });
    mswServer.use(
      http.get('/api/v1/prompt-sets', () => HttpResponse.json(makeSetList([pagedSet]))),
      http.get(`/api/v1/prompt-sets/${pagedSet.id}/candidates`, () => HttpResponse.json([])),
      http.get(`/api/v1/projects/${pagedProject.id}/topics`, () => HttpResponse.json([])),
      http.get(`/api/v1/projects/${pagedProject.id}/visibility/prompts`, () =>
        HttpResponse.json([]),
      ),
    );
    window.history.replaceState(null, '', `/projects/${pagedProject.id}/prompts?page=2`);
    const user = userEvent.setup();
    renderWithProviders(<PromptLibrary />, {
      projectSelection: {
        projects: [pagedProject],
        activeProject: pagedProject,
        activeProjectId: pagedProject.id,
        status: 'ready',
      },
    });

    const table = await screen.findByRole('table', { name: 'Prompts' });
    expect(within(table).queryByText('Best trail boots?')).toBeNull();
    await user.type(screen.getByRole('searchbox', { name: 'Search prompts' }), 'boots');

    expect(await within(table).findByText('Best trail boots?')).toBeVisible();
    expect(new URLSearchParams(window.location.search).has('page')).toBe(false);
    window.history.replaceState(null, '', '/');
  });
});

describe('PromptLibrary row changes', () => {
  it.each([
    ['Archive', 'patch', "Couldn't archive this prompt"],
    ['Delete', 'delete', "Couldn't delete this prompt"],
  ] as const)('reports a failed %s', async (item, method, message) => {
    libraryReads(async () => HttpResponse.json([]));
    mswServer.use(
      http[method](`/api/v1/prompts/${prompt.id}`, () =>
        HttpResponse.json({ error: { message: 'down' } }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <ToastProvider>
        <PromptLibrary />
      </ToastProvider>,
      {
        projectSelection: {
          projects: [project],
          activeProject: project,
          activeProjectId: project.id,
          status: 'ready',
        },
      },
    );

    const table = await screen.findByRole('table', { name: 'Prompts' });
    await user.click(within(table).getByRole('button', { name: 'Prompt actions' }));
    await user.click(await screen.findByRole('menuitem', { name: item }));
    if (item === 'Delete')
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', { name: /Delete/ }),
      );

    expect(await screen.findByText(message)).toBeVisible();
  });
});

describe('PromptLibrary never filled', () => {
  it('offers Add prompts and no status, search or filters, with Launch run held', async () => {
    const emptySet = makeSet([]);
    mswServer.use(
      http.get('/api/v1/prompt-sets', () => HttpResponse.json(makeSetList([emptySet]))),
      http.get(`/api/v1/prompt-sets/${emptySet.id}/candidates`, () => HttpResponse.json([])),
      http.get(`/api/v1/projects/${project.id}/topics`, () => HttpResponse.json([])),
      http.get(`/api/v1/projects/${project.id}/visibility/prompts`, () => HttpResponse.json([])),
    );
    renderLibrary();

    expect(await screen.findByRole('button', { name: 'Add prompts' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Launch run' })).toHaveAccessibleDescription(
      'Add an active prompt to launch a run.',
    );
    expect(screen.queryByRole('textbox', { name: 'Search prompts' })).toBeNull();
    expect(screen.queryByRole('tab', { name: /Active/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Filters/ })).toBeNull();
  });
});

describe('PromptLibrary failed read', () => {
  it('names the failed prompts read once, without a second block for the topics', async () => {
    const empty = makeProject({ prompt_sets: [] });
    const failure = () => HttpResponse.json({ error: { message: 'down' } }, { status: 500 });
    mswServer.use(
      http.get('/api/v1/prompt-sets', failure),
      http.get(`/api/v1/projects/${empty.id}/topics`, failure),
      http.get(`/api/v1/projects/${empty.id}/visibility/prompts`, () => HttpResponse.json([])),
    );
    renderWithProviders(<PromptLibrary />, {
      projectSelection: {
        projects: [empty],
        activeProject: empty,
        activeProjectId: empty.id,
        status: 'ready',
      },
    });

    expect(await screen.findByText("Couldn't load the prompts")).toBeVisible();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Retry/ })).toHaveLength(1));
    expect(screen.queryByText(/topics/i)).toBeNull();
  });
});

describe('PromptLibrary by role', () => {
  it.each([
    ['member', ['Add prompts', 'Launch run'], ['', 'Prompt', 'Topic', 'Actions']],
    ['viewer', [], ['Prompt', 'Topic']],
  ] as const)(
    'offers a %s exactly the controls its role may use',
    async (role, pageActions, headers) => {
      libraryReads(async () => HttpResponse.json([]));
      renderWithProviders(<PromptLibrary />, {
        projectSelection: {
          ...selectionAs(role),
          projects: [project],
          activeProject: project,
          activeProjectId: project.id,
          status: 'ready',
        },
      });

      const table = await screen.findByRole('table', { name: 'Prompts' });
      expect(
        within(table)
          .getAllByRole('columnheader')
          .map((head) => head.textContent),
      ).toEqual(headers);
      const offered = ['Add prompts', 'Launch run'].filter((name) =>
        screen.queryByRole('button', { name: new RegExp(name) }),
      );
      expect(offered).toEqual(pageActions);
    },
  );
});

describe('PromptLibrary bulk actions', () => {
  const rows = ['Best trail shoes?', 'Best road shoes?', 'Best gym shoes?'].map((text, index) =>
    makePrompt({ id: `66666666-6666-4666-8666-66666666667${index}`, text }),
  );
  const beyond = makePrompt({
    id: '66666666-6666-4666-8666-666666666680',
    text: 'Best hiking boots?',
    status: 'archived',
    over_plan_limit: true,
  });
  const bulkSet = makeSet([...rows, beyond]);
  const bulkProject = makeProject({ prompt_sets: [bulkSet] });

  function renderBulk() {
    const bodies: unknown[] = [];
    mswServer.use(
      http.get('/api/v1/prompt-sets', () => HttpResponse.json(makeSetList([bulkSet]))),
      http.get(`/api/v1/prompt-sets/${bulkSet.id}/candidates`, () => HttpResponse.json([])),
      http.get(`/api/v1/projects/${bulkProject.id}/topics`, () => HttpResponse.json([])),
      http.get(`/api/v1/projects/${bulkProject.id}/visibility/prompts`, () =>
        HttpResponse.json([]),
      ),
      http.post(`/api/v1/prompt-sets/${bulkSet.id}/prompts/bulk-status`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(bulkSet);
      }),
    );
    renderWithProviders(<PromptLibrary />, {
      projectSelection: {
        projects: [bulkProject],
        activeProject: bulkProject,
        activeProjectId: bulkProject.id,
        status: 'ready',
      },
    });
    return { bodies, user: userEvent.setup() };
  }

  const box = (text: string) => screen.getByRole('checkbox', { name: `Select “${text}”` });

  it('archives a shift-clicked range in one request, then clears the selection', async () => {
    const { bodies, user } = renderBulk();
    await screen.findByRole('table', { name: 'Prompts' });
    await user.click(box('Best trail shoes?'));
    await user.keyboard('{Shift>}');
    await user.click(box('Best gym shoes?'));
    await user.keyboard('{/Shift}');
    const bar = screen.getByRole('toolbar', { name: 'Selected prompts' });
    expect(within(bar).getByText('3 selected')).toBeVisible();

    await user.click(within(bar).getByRole('button', { name: 'Archive' }));
    await waitFor(() =>
      expect(bodies).toEqual([{ prompt_ids: rows.map((row) => row.id), status: 'archived' }]),
    );
    await waitFor(() =>
      expect(screen.queryByRole('toolbar', { name: 'Selected prompts' })).not.toBeInTheDocument(),
    );
  });

  it('clears the selection when the filters change and holds Activate beyond the plan limit', async () => {
    window.history.replaceState(null, '', `/projects/${bulkProject.id}/prompts?status=archived`);
    const { bodies, user } = renderBulk();
    await screen.findByRole('table', { name: 'Prompts' });
    await user.click(box('Best hiking boots?'));
    const activate = within(screen.getByRole('toolbar', { name: 'Selected prompts' })).getByRole(
      'button',
      { name: 'Activate' },
    );
    expect(activate).toHaveAttribute('aria-disabled', 'true');
    expect(activate).toHaveAccessibleDescription(
      /1 selected prompt is beyond your plan's prompt limit/,
    );
    await user.click(activate);
    expect(bodies).toEqual([]);

    await user.type(screen.getByRole('searchbox'), 'boots');
    expect(screen.queryByRole('toolbar', { name: 'Selected prompts' })).not.toBeInTheDocument();

    await user.click(box('Best hiking boots?'));
    const travel = (status: string) =>
      act(() => {
        window.history.pushState(null, '', `/projects/${bulkProject.id}/prompts?status=${status}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
    travel('active');
    travel('archived');
    expect(box('Best hiking boots?')).not.toBeChecked();
    window.history.replaceState(null, '', '/');
  });
});

describe('PromptLibrary Enable/Disable', () => {
  function holdToggle() {
    const held: { answer?: (response: Response) => void; setsReads: number; saves: number } = {
      setsReads: 0,
      saves: 0,
    };
    let saved = prompt;
    libraryReads(async () => HttpResponse.json([]));
    mswServer.use(
      http.get('/api/v1/prompt-sets', () => {
        held.setsReads += 1;
        return HttpResponse.json(makeSetList([makeSet([saved])]));
      }),
      http.patch(`/api/v1/prompts/${prompt.id}`, async () => {
        held.saves += 1;
        const response = await new Promise<Response>((resolve) => {
          held.answer = resolve;
        });
        if (response.ok) saved = { ...saved, enabled: !saved.enabled };
        return response;
      }),
    );
    return held;
  }

  async function press(user: ReturnType<typeof userEvent.setup>, item: 'Enable' | 'Disable') {
    const table = await screen.findByRole('table', { name: 'Prompts' });
    await user.click(within(table).getByRole('button', { name: 'Prompt actions' }));
    await user.click(await screen.findByRole('menuitem', { name: item }));
    return () => within(table).getByRole('link', { name: prompt.text }).closest('td');
  }

  it('flips at once and rolls back with the failure when the save fails', async () => {
    const held = holdToggle();
    renderLibrary();
    const status = await press(userEvent.setup(), 'Disable');

    await waitFor(() => expect(status()).toHaveTextContent('Disabled'));
    const answer = await vi.waitFor(() => {
      if (!held.answer) throw new Error('The save was not requested yet.');
      return held.answer;
    });
    answer(HttpResponse.json({ error: { message: 'down' } }, { status: 503 }));

    expect(await screen.findByText(/Could not turn the prompt on or off/)).toBeVisible();
    expect(status()).not.toHaveTextContent('Disabled');
  });

  it('ignores a second press while saving, keeps the new state once saved and re-reads the library', async () => {
    const held = holdToggle();
    const user = userEvent.setup();
    renderLibrary();
    const status = await press(user, 'Disable');
    const readsBefore = held.setsReads;

    await waitFor(() => expect(status()).toHaveTextContent('Disabled'));
    const answer = await vi.waitFor(() => {
      if (!held.answer) throw new Error('The save was not requested yet.');
      return held.answer;
    });
    await press(user, 'Enable');
    expect(status()).toHaveTextContent('Disabled');
    answer(HttpResponse.json({ ...prompt, enabled: false }));

    await waitFor(() => expect(held.setsReads).toBeGreaterThan(readsBefore));
    expect(status()).toHaveTextContent('Disabled');
    expect(held.saves).toBe(1);
    expect(screen.queryByText(/Could not turn the prompt on or off/)).toBeNull();
  });
});

describe('PromptLibrary topic filter', () => {
  it('filters the table by the topic chosen in the control strip', async () => {
    const topic = {
      id: '77777777-7777-4777-8777-777777777777',
      project_id: project.id,
      name: 'Trail',
      description: '',
      origin: 'manual',
      active_count: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const filed = makePrompt({
      id: '88888888-8888-4888-8888-888888888888',
      text: 'Best trail shoes?',
      topic_id: topic.id,
    });
    const unfiled = makePrompt({
      id: '99999999-9999-4999-8999-999999999999',
      text: 'Best road shoes?',
      topic_id: null,
    });
    const topicSet = makeSet([filed, unfiled]);
    const topicProject = makeProject({ prompt_sets: [topicSet] });
    mswServer.use(
      http.get('/api/v1/prompt-sets', () => HttpResponse.json(makeSetList([topicSet]))),
      http.get(`/api/v1/prompt-sets/${topicSet.id}/candidates`, () => HttpResponse.json([])),
      http.get(`/api/v1/projects/${topicProject.id}/topics`, () => HttpResponse.json([topic])),
      http.get(`/api/v1/projects/${topicProject.id}/visibility/prompts`, () =>
        HttpResponse.json([]),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<PromptLibrary />, {
      projectSelection: {
        projects: [topicProject],
        activeProject: topicProject,
        activeProjectId: topicProject.id,
        status: 'ready',
      },
    });

    const table = await screen.findByRole('table', { name: 'Prompts' });
    expect(within(table).getByText('Best road shoes?')).toBeVisible();
    await screen.findByRole('button', { name: 'Topic: All topics' });
    await chooseFilterOption(user, 'Topic', /^Trail/);

    await waitFor(() => expect(within(table).getByText('Best trail shoes?')).toBeVisible());
    expect(within(table).queryByText('Best road shoes?')).not.toBeInTheDocument();
    expect(await openFilterRow(user, 'Topic', 'Trail')).toBeVisible();
    await user.keyboard('{Escape}');

    await user.type(screen.getByRole('searchbox', { name: 'Search prompts' }), 'boots');
    await user.click(await screen.findByRole('button', { name: 'Clear filters' }));
    expect(await within(table).findByText('Best road shoes?')).toBeVisible();
    expect(within(table).getByText('Best trail shoes?')).toBeVisible();
    expect(screen.getByRole('searchbox', { name: 'Search prompts' })).toHaveValue('');
  });

  it('opens on the status the URL names, so a linked Archived view shows the archived prompts', async () => {
    const active = makePrompt({
      id: '66666666-6666-4666-8666-666666666661',
      text: 'Best trail shoes?',
    });
    const archived = makePrompt({
      id: '66666666-6666-4666-8666-666666666662',
      text: 'Best road shoes?',
      status: 'archived',
    });
    const statusSet = makeSet([active, archived]);
    const statusProject = makeProject({ prompt_sets: [statusSet] });
    mswServer.use(
      http.get('/api/v1/prompt-sets', () => HttpResponse.json(makeSetList([statusSet]))),
      http.get(`/api/v1/prompt-sets/${statusSet.id}/candidates`, () => HttpResponse.json([])),
      http.get(`/api/v1/projects/${statusProject.id}/topics`, () => HttpResponse.json([])),
      http.get(`/api/v1/projects/${statusProject.id}/visibility/prompts`, () =>
        HttpResponse.json([]),
      ),
    );
    window.history.replaceState(null, '', `/projects/${statusProject.id}/prompts?status=archived`);
    renderWithProviders(<PromptLibrary />, {
      projectSelection: {
        projects: [statusProject],
        activeProject: statusProject,
        activeProjectId: statusProject.id,
        status: 'ready',
      },
    });

    const table = await screen.findByRole('table', { name: 'Prompts' });
    expect(within(table).getByText('Best road shoes?')).toBeVisible();
    expect(within(table).queryByText('Best trail shoes?')).not.toBeInTheDocument();
    window.history.replaceState(null, '', '/');
  });
});
