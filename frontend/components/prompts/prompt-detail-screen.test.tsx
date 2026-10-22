import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vite-plus/test';

import { TooltipProvider } from '@/components/ui/tooltip';
import { createAppQueryClient } from '@/lib/api/query-client';
import type { PromptHistory } from '@/lib/api/types';

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
  const context = () => ({
    activeProjectId: PROJECT,
    activeWorkspaceId: WORKSPACE,
  });
  return { useProjectContext: context, useOptionalProjectContext: context };
});

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
        status: 'measuring',
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
          ]
        : [],
    },
  };
}

function renderScreen(path = `/prompts/${PROMPT}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={createAppQueryClient()}>
        <TooltipProvider>
          <Routes>
            <Route path="/prompts/:promptId" element={<PromptDetailScreen />} />
          </Routes>
        </TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getPromptHistory.mockReset();
  window.history.replaceState(null, '', '/');
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

  const chart = await screen.findByRole('img', {
    name: /^Mention rate over time/,
  });
  expect(chart).toHaveAccessibleName(/Marked: Marked implemented .+: reviews\.example\/crm\.$/);
  expect(getPromptHistory).toHaveBeenCalledWith(
    PROJECT,
    PROMPT,
    { market: undefined },
    expect.anything(),
  );
  expect(screen.getByRole('link', { name: 'reviews.example/crm' })).toHaveAttribute(
    'href',
    `/agent/actions/${EARNED}?project=${PROJECT}`,
  );

  const states = within(screen.getByLabelText('Answers by state'));
  expect(states.getByText('Mentioned and cited').closest('div')).toHaveTextContent(
    'Mentioned and cited1Named you and cited one of your pages.',
  );
  expect(states.getByText('Neither').closest('div')).toHaveTextContent(
    'Neither1Did not name you or cite your site.',
  );
  const gaps = within(screen.getByRole('region', { name: 'Competitors named without you' }));
  expect(gaps.getByRole('row', { name: /Globex/ })).toHaveTextContent('Globex1ChatGPT API');
  expect(screen.getByRole('link', { name: 'Open the Action' })).toHaveAttribute(
    'href',
    `/agent/actions/${ACTION}?project=${PROJECT}`,
  );
});

it('reads the market from the address and keeps a run without answers unavailable', async () => {
  getPromptHistory.mockResolvedValue(history(null));
  // The market lives in the address bar, which URL state reads directly.
  window.history.replaceState(null, '', `/prompts/${PROMPT}?market=${RUN(7)}`);
  renderScreen(`/prompts/${PROMPT}?market=${RUN(7)}`);

  expect(
    await screen.findByText(/mentions and citations are unavailable rather than zero/),
  ).toBeInTheDocument();
  expect(getPromptHistory).toHaveBeenCalledWith(
    PROJECT,
    PROMPT,
    { market: RUN(7) },
    expect.anything(),
  );
});
