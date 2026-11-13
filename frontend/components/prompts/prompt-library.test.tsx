import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import { makeProject } from '@/test/fixtures/project';
import { makePrompt, makeSet, makeSetList } from '@/test/fixtures/prompts';
import { mswServer } from '@/test/msw-server';
import { chooseFilterOption, openFilterRow } from '@/test/all-filters';
import { renderWithProviders, selectionAs } from '@/test/render';

import { PromptLibrary } from './prompt-library';

const prompt = makePrompt({ text: 'Best running shoes for flat feet?' });
const set = makeSet([prompt]);
// The prompts arrive embedded in the project, before any read of their figures.
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

/** The library's reads, with the latest run's figures answered by `figures`. */
function libraryReads(figures: () => Promise<Response>) {
  mswServer.use(
    http.get('/api/v1/prompt-sets', () => HttpResponse.json(makeSetList([set]))),
    http.get(`/api/v1/prompt-sets/${set.id}/candidates`, () => HttpResponse.json([])),
    http.get(`/api/v1/projects/${project.id}/topics`, () => HttpResponse.json([])),
    http.get(`/api/v1/projects/${project.id}/visibility/prompts`, figures),
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

    // The prompts are already known, but whether a run exists decides the
    // columns, so no row is drawn while the figures are being read.
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
      'Prompt',
      'Visibility',
      expect.stringMatching(/^Mentions/),
      expect.stringMatching(/^Citations/),
      expect.stringMatching(/^Position/),
      'Change',
      'Enabled',
      'Actions',
    ]);
    const row = within(table).getByRole('row', { name: new RegExp(prompt.text.slice(0, 20)) });
    expect(within(row).getByText('50%')).toBeVisible();
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

    await user.click(await screen.findByRole('button', { name: 'Prompt actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Evidence' }));

    expect(await screen.findByRole('dialog', { name: 'Execution evidence' })).toBeVisible();
    await waitFor(() => expect(read).toContain(ANSWER));
    expect(new Set(read)).toEqual(new Set([ANSWER]));
  });

  it('draws the prompt rows without measured columns when the figures cannot be read', async () => {
    libraryReads(async () =>
      HttpResponse.json({ detail: 'Not allowed.', code: 'forbidden' }, { status: 403 }),
    );

    renderLibrary();

    const table = await screen.findByRole('table', { name: 'Prompts' });
    expect(within(table).getByText(prompt.text)).toBeVisible();
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((head) => head.textContent),
    ).toEqual(['Prompt', 'Enabled', 'Actions']);
  });
});

describe('PromptLibrary by role', () => {
  it.each([
    ['member', ['Add prompts', 'Launch audit'], ['Prompt', 'Enabled', 'Actions']],
    ['viewer', [], ['Prompt', 'Enabled']],
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
      const offered = ['Add prompts', 'Launch audit'].filter((name) =>
        screen.queryByRole('button', { name: new RegExp(name) }),
      );
      expect(offered).toEqual(pageActions);
    },
  );
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
    await screen.findByRole('button', { name: 'All filters' });
    await chooseFilterOption(user, 'Topic', /^Trail/);

    await waitFor(() => expect(within(table).getByText('Best trail shoes?')).toBeVisible());
    expect(within(table).queryByText('Best road shoes?')).not.toBeInTheDocument();
    expect(await openFilterRow(user, 'Topic', 'Trail')).toBeVisible();
  });
});
