import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vite-plus/test';

import { TooltipProvider } from '@/components/ui/tooltip';
import { ActiveProjectScopeProvider } from '@/lib/project/active-project-scope';
import { makeProject } from '@/test/fixtures/project';
import { testQueryClient } from '@/test/render';
import type { PromptHistory } from '@citeladder/contracts';

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROMPT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ACTION = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EARNED = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const RUN = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const { getPromptHistory } = vi.hoisted(() => ({
  getPromptHistory:
    vi.fn<
      (projectId: string, promptId: string, params: { market?: string }) => Promise<PromptHistory>
    >(),
}));
vi.mock('@/lib/api/visibility', () => ({
  visibilityApi: { getPromptHistory },
}));
vi.mock('@/lib/project/use-project-markets', () => ({
  useProjectMarkets: () => [],
}));
vi.mock('@/lib/project/project-context', () => {
  const context = () => ({ activeProjectId: PROJECT, activeWorkspaceId: WORKSPACE });
  return {
    useProjectContext: context,
    useOptionalProjectContext: context,
    useWorkspaceCapability: () => true,
  };
});

import { ApiError } from '@/lib/api/errors';
import { promptsApi } from '@/lib/api/prompts';
import { runsApi } from '@/lib/api/runs';
import type { PromptAnswer } from '@citeladder/contracts';
import { PromptDetailScreen } from './prompt-detail-screen';

const counts = (responses: number, failed = 0) => ({
  state: responses ? 'measured' : 'no_observations',
  responses,
  brand_responses: null,
  owned_citation_responses: null,
  entity_presences: null,
  expected: responses + failed,
  failed,
  not_run: 0,
});

const point = (
  n: number,
  day: string,
  mention: number | null,
  cited: number | null,
  comparable: boolean | null,
) => ({
  audit_id: RUN(n),
  completed_at: `2026-03-${day}T00:00:00Z`,
  prompt_text: 'best crm',
  counts: counts(mention === null ? 0 : 2, mention === null ? 1 : 0),
  mention_rate: mention,
  owned_citation_rate: cited,
  answer_states: null,
  source_analysis_ids: [],
  comparison_key: 'key',
  analyzer_version: 'v1',
  scoring_rule_version: 'v1',
  comparable_with_previous: comparable,
  source_snapshot_id: RUN(n),
});

function history(latestStates: PromptHistory['points'][number]['answer_states']): PromptHistory {
  return {
    prompt: { id: PROMPT, text: 'best crm', topic_id: null, status: 'active' },
    cohort: 'core',
    market_id: null,
    logical_engine: null,
    points: [
      point(1, '02', 0.5, 0, null),
      point(2, '09', null, null, true),
      point(3, '16', 1, 0.5, true),
    ],
    implementations: [
      {
        implementation_event_id: RUN(8),
        action_id: EARNED,
        title: 'reviews.example/crm',
        status: 'done',
        implemented_at: '2026-03-05T12:00:00Z',
      },
    ],
    latest: {
      id: RUN(9),
      audit_id: RUN(3),
      prompt_id: PROMPT,
      prompt_index: 0,
      prompt_text: 'best crm',
      cohort: 'core',
      composite_score: 50,
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
      created_at: '2026-03-16T00:00:00Z',
      action_id: ACTION,
      mentions: 0,
      brands: [],
      counts: counts(latestStates ? 2 : 0, 1),
      answer_states: latestStates,
      outcomes: latestStates
        ? [
            {
              logical_engine: 'chatgpt',
              transport_model: 'model',
              counts: counts(2),
              visibility_rate: 0.5,
              owned_citation_rate: 0.5,
              answer_states: latestStates,
              gap_counts: { Globex: 1 },
            },
            {
              logical_engine: 'gemini',
              transport_model: 'model',
              counts: counts(0, 1),
              visibility_rate: null,
              owned_citation_rate: null,
              answer_states: null,
              gap_counts: {},
            },
          ]
        : [],
    },
  };
}

function renderScreen(path = `/prompts/${PROMPT}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={testQueryClient()}>
        <TooltipProvider>
          <ActiveProjectScopeProvider
            project={makeProject({ id: PROJECT, workspace_id: WORKSPACE })}
          >
            <Routes>
              <Route path="/prompts/:promptId" element={<PromptDetailScreen />} />
            </Routes>
          </ActiveProjectScopeProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const listPromptExecutions = vi.spyOn(runsApi, 'listPromptExecutions');

beforeEach(() => {
  getPromptHistory.mockReset();
  listPromptExecutions
    .mockReset()
    .mockResolvedValue({ market_id: null, items: [], next_cursor: null });
  window.history.replaceState(null, '', '/');
});

const ANSWER_FORMATS: readonly PromptAnswer['answer_formats'][] = [
  { kind: 'observed', formats: ['shopping', 'comparison'], in_text_links: 1 },
  { kind: 'observed', formats: [], in_text_links: 0 },
];

const pastAnswer = (n: number, search: PromptAnswer['search']): PromptAnswer => ({
  execution_id: RUN(n),
  audit_id: RUN(1),
  run_at: '2026-03-16T00:00:00Z',
  logical_engine: 'claude',
  brands:
    n === 1
      ? [
          { kind: 'competitor', name: 'Globex', logo_url: null, website: null },
          { kind: 'brand', name: 'Acme', logo_url: null, website: null },
        ]
      : [],
  first_named: n === 1 ? { kind: 'brand', name: 'Acme' } : { kind: 'none' },
  brand_mentioned: n === 1,
  position: n === 1 ? 2 : null,
  cited: n === 1,
  search,
  answer_formats: ANSWER_FORMATS[n - 1] ?? { kind: 'not_applicable' },
});

it('shows the not-found state for a prompt the API cannot find, and an error for any other failure', async () => {
  getPromptHistory.mockRejectedValueOnce(new ApiError('Prompt not found', 404, '{}'));
  const notFound = renderScreen();
  expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  expect(screen.queryByText("Couldn't load this prompt")).toBeNull();
  notFound.unmount();

  getPromptHistory.mockRejectedValueOnce(new ApiError('Server error', 500, '{}'));
  renderScreen();
  expect(await screen.findByText("Couldn't load this prompt")).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Page not found' })).toBeNull();
});

it('reads Past answers under the strip filters, keeping an unreported search apart from no', async () => {
  getPromptHistory.mockResolvedValue(history(null));
  listPromptExecutions.mockResolvedValue({
    market_id: null,
    next_cursor: null,
    items: [pastAnswer(1, 'used'), pastAnswer(2, 'not_used'), pastAnswer(3, 'not_reported')],
  });
  const path = `/prompts/${PROMPT}?engine=claude&period=all&brand=Globex&cited=cited&search=used`;
  window.history.replaceState(null, '', path);
  renderScreen(path);

  const table = await screen.findByRole('table', { name: 'Past answers' });
  await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(4));
  const rows = within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .slice(4)
        .map((cell) => cell.textContent),
    );
  expect(rows).toEqual([
    ['#2', 'Cited', 'Yes', 'ShoppingComparison'],
    ['—Not named', '—Not cited', 'No', '—None'],
    ['—Not named', '—Not cited', '—Not reported', '—Not applicable'],
  ]);
  const bold = [...table.querySelectorAll('tbody strong')].map((name) => name.textContent);
  expect(bold).toEqual(['Acme, named first']);
  expect(listPromptExecutions).toHaveBeenCalledWith(
    expect.objectContaining({ projectId: PROJECT }),
    PROMPT,
    { engine: 'claude', brand: 'Globex', cited: true, search: 'used', limit: 25 },
    expect.anything(),
  );
  expect(screen.getByRole('button', { name: 'Filters (3)' })).toBeVisible();
  expect(screen.getByRole('button', { name: /^Engine: / })).toBeVisible();
  expect(screen.getByRole('button', { name: /^Period/ })).toBeVisible();
  expect(getPromptHistory).toHaveBeenCalledWith(
    PROJECT,
    PROMPT,
    { engine: 'claude' },
    expect.anything(),
  );
});

it('charts the prompt over time with declared work marked, and hands off to its Action', async () => {
  getPromptHistory.mockResolvedValue(
    history({
      mentioned_and_cited: 1,
      mentioned_only: 0,
      cited_only: 0,
      neither: 1,
    }),
  );
  renderScreen();

  const marked = await screen.findByRole('list', { name: 'Visibility over time: marked' });
  expect(marked.textContent).toMatch(/^Marked implemented .+: reviews\.example\/crm$/);
  expect(screen.getByText('Marked implemented')).toBeVisible();
  expect(getPromptHistory).toHaveBeenCalledWith(
    PROJECT,
    PROMPT,
    { market: undefined },
    expect.anything(),
  );
  expect(screen.getByRole('link', { name: 'reviews.example/crm' })).toHaveAttribute(
    'href',
    `/actions/${EARNED}?project=${PROJECT}`,
  );

  const states = within(screen.getByRole('group', { name: 'Latest measurement' }));
  const stateCell = (label: string) =>
    states.getByText(label).closest('[data-figure-cell]')?.textContent;
  expect(stateCell('Mentioned and cited')).toMatch(/^Mentioned and cited.*1$/);
  expect(states.queryByText('Neither')).toBeNull();
  await userEvent
    .setup()
    .click(states.getByRole('button', { name: 'Basis of Mentioned and cited' }));
  expect(
    await screen.findAllByText(/Mentioned only: 0 · Cited only: \d+ · Neither: 1$/u),
  ).not.toHaveLength(0);
  const coverage = within(screen.getByRole('table', { name: 'Engine coverage' }));
  const cells = (engine: RegExp) =>
    within(coverage.getByRole('row', { name: engine }))
      .getAllByRole('cell')
      .slice(1);
  expect(cells(/ChatGPT API/).map((cell) => cell.textContent)).toEqual(['2/2', '1', '1']);
  const failed = cells(/Gemini API/);
  expect(failed[0]!.textContent).toBe('0/1');
  expect(
    failed
      .slice(1)
      .map((cell) => cell.querySelector('[data-absence]')?.getAttribute('data-absence')),
  ).toEqual(['unavailable', 'unavailable']);
  expect(screen.getByRole('link', { name: 'Open Action' })).toHaveAttribute(
    'href',
    `/actions/${ACTION}?project=${PROJECT}`,
  );
});

it('opens on where the prompt stands: the latest rates and their change', async () => {
  const base = history(null);
  getPromptHistory.mockResolvedValue({
    ...base,
    latest: { ...base.latest!, visibility_delta: 12.5, avg_position: 1.5 },
  });
  renderScreen();

  const figures = within(await screen.findByRole('group', { name: 'Latest measurement' }));
  const cell = (label: string) =>
    figures.getByText(label).closest('[data-figure-cell]')?.textContent;
  expect(cell('Visibility')).toMatch(/^Visibility.*100\.0%.*12\.5 pp/);
  expect(cell('Owned citation rate')).toMatch(/^Owned citation rate.*50\.0%$/);
  expect(cell('Position')).toMatch(/^Position.*1\.5$/);
  expect(screen.getByText('Show run data (3)')).toBeVisible();
  const latestDate = screen
    .getAllByText(/Mar 16, 2026/)
    .filter((element) => !element.closest('details, [data-chart-frame]'));
  expect(latestDate).toHaveLength(1);
  expect(latestDate[0]!.closest('[data-figure-cell]')).toBe(
    figures.getByText('Visibility').closest('[data-figure-cell]'),
  );
});

it('reads every rate as unavailable when the latest run had no successful answer', async () => {
  const base = history(null);
  getPromptHistory.mockResolvedValue({ ...base, points: base.points.slice(0, 2) });
  renderScreen();

  const figures = within(await screen.findByRole('group', { name: 'Latest measurement' }));
  const state = (label: string) =>
    figures
      .getByText(label)
      .closest('[data-figure-cell]')
      ?.querySelector('[data-absence]')
      ?.getAttribute('data-absence');
  expect(['Visibility', 'Owned citation rate', 'Position'].map(state)).toEqual([
    'unavailable',
    'unavailable',
    'unavailable',
  ]);
  expect(figures.getByText('Position').closest('[data-figure-cell]')).toHaveTextContent(
    'No answers',
  );
});

it('says an archived prompt is archived and restores it', async () => {
  const user = userEvent.setup();
  const updatePrompt = vi.spyOn(promptsApi, 'updatePrompt').mockResolvedValue({} as never);
  const base = history(null);
  getPromptHistory
    .mockResolvedValueOnce({ ...base, prompt: { ...base.prompt, status: 'archived' } })
    .mockResolvedValue(base);
  renderScreen();

  expect(await screen.findByText('Runs no longer ask this prompt.')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Restore' }));

  expect(updatePrompt).toHaveBeenCalledWith(PROMPT, { status: 'active' }, expect.anything());
  await waitFor(() =>
    expect(screen.queryByText('Runs no longer ask this prompt.')).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('group', { name: 'Latest measurement' })).toBeVisible();
});

it('reads the market from the address and keeps a run without answers unavailable', async () => {
  const base = history(null);
  getPromptHistory.mockResolvedValue({
    ...base,
    points: base.points.map((p, i) => (i === 0 ? { ...p, owned_citation_rate: null } : p)),
  });
  window.history.replaceState(null, '', `/prompts/${PROMPT}?market=${RUN(7)}`);
  renderScreen(`/prompts/${PROMPT}?market=${RUN(7)}`);

  const figures = within(await screen.findByRole('group', { name: 'Latest measurement' }));
  expect(getPromptHistory).toHaveBeenCalledWith(
    PROJECT,
    PROMPT,
    { market: RUN(7) },
    expect.anything(),
  );
  expect(
    figures
      .getByText('Mentioned and cited')
      .closest('[data-figure-cell]')
      ?.querySelector('[data-absence]'),
  ).toHaveAttribute('data-absence', 'unavailable');
  expect(figures.getByText('Visibility').closest('[data-figure-cell]')?.textContent).toMatch(
    /^Visibility.*100\.0%$/,
  );
  await userEvent.setup().click(screen.getByText('Show run data (3)'));
  const runs = within(screen.getByRole('table', { name: 'Runs that measured this prompt' }))
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    );
  expect(runs).toEqual([
    [expect.stringMatching(/^Mar 16, 2026/), '100.0%', '50.0%'],
    [expect.stringMatching(/^Mar 9, 2026/), '—No answers', '—No answers'],
    [expect.stringMatching(/^Mar 2, 2026/), '50.0%', expect.stringMatching(/Not measured$/)],
  ]);
});
