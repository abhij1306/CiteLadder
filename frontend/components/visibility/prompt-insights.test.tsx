import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vite-plus/test';

import { ApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

import { CompetitorSuggestions } from './prompt-insights';

const { acceptCompetitorSuggestion, rejectCompetitorSuggestion } = vi.hoisted(() => ({
  acceptCompetitorSuggestion: vi.fn().mockResolvedValue(undefined),
  rejectCompetitorSuggestion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/api/visibility', () => ({
  visibilityApi: { acceptCompetitorSuggestion, rejectCompetitorSuggestion },
}));

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
beforeEach(() =>
  mswServer.use(
    http.get('/api/v1/brand-discovery-catalog', () =>
      HttpResponse.json({ maximum_competitors: 5, industries: [], subindustries: {} }),
    ),
  ),
);
afterEach(() => {
  vi.clearAllMocks();
  mswServer.resetHandlers();
});
afterAll(() => mswServer.close());

const projectId = '11111111-1111-4111-8111-111111111111';
const shared = {
  audit_id: '33333333-3333-4333-8333-333333333333',
  qualification_reason: 'Repeated across prompts',
  engine_count: 2,
  market_relevant: false,
  analyzer_version: 'competitor-v1',
  source_analysis_ids: [],
  source_artifact_ids: [],
  status: 'pending',
  created_at: '2026-11-18T00:00:00.000Z',
};
const suggestionsQuery = {
  data: [
    {
      ...shared,
      id: '22222222-2222-4222-8222-222222222222',
      kind: 'cited_domain',
      name: 'Northstar',
      domain: 'northstar.test',
      citation_count: 7,
      prompt_count: 3,
      engine_total: 4,
    },
    {
      ...shared,
      id: '44444444-4444-4444-8444-444444444444',
      kind: 'named_in_answers',
      name: 'Ledgerly',
      prompt_count: 5,
      engine_total: 3,
    },
  ],
  isError: false,
  isLoading: false,
} as never;

function renderSuggestions(tracked = 2) {
  const rendered = renderWithProviders(
    <CompetitorSuggestions
      projectId={projectId}
      tracked={tracked}
      suggestionsQuery={suggestionsQuery}
    />,
  );
  const facts = queryKeys.projects.commandCenter({ workspaceId: null, projectId });
  const suggestions = queryKeys.visibility.competitorSuggestions({ workspaceId: null, projectId });
  for (const key of [facts, suggestions]) rendered.queryClient.setQueryData(key, {});
  const stale = () =>
    [facts, suggestions].map((key) => rendered.queryClient.getQueryState(key)?.isInvalidated);
  return { stale };
}

describe('CompetitorSuggestions', () => {
  it('shows what found each suggestion: citations of a domain, prompts naming a name', () => {
    renderSuggestions();
    const cells = (name: string) =>
      Array.from(
        screen.getByText(name).closest('tr')!.querySelectorAll('td'),
        (cell) => cell.textContent,
      ).slice(1, 4);
    expect(cells('Northstar')).toEqual(['Cited domain', '7 citations', '2 of 4']);
    expect(cells('Ledgerly')).toEqual(['Named in answers', '5 prompts', '2 of 3']);
  });

  it('refreshes company facts after accepting a competitor', async () => {
    const user = userEvent.setup({ delay: null });
    const { stale } = renderSuggestions();

    await user.click(screen.getByRole('button', { name: 'Accept Northstar as a competitor' }));

    await waitFor(() => expect(stale()).toEqual([true, true]));
  });

  it('holds Accept at the competitor limit and says how to make room, while Reject stays open', async () => {
    const { unmount } = renderWithProviders(
      <CompetitorSuggestions
        projectId={projectId}
        tracked={5}
        suggestionsQuery={suggestionsQuery}
      />,
    );
    expect(
      await screen.findByText(
        'Your project tracks the maximum of 5 competitors. Remove one to accept a suggestion.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Accept Northstar as a competitor' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject Northstar as a competitor' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Edit competitors' })).toBeVisible();
    unmount();

    renderSuggestions(4);
    expect(await screen.findByText(/4 of 5 tracked/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Accept Northstar as a competitor' })).toBeEnabled();
  });

  it('shows the reason the server gives when an accept is refused, without Try again', async () => {
    const user = userEvent.setup({ delay: null });
    acceptCompetitorSuggestion.mockRejectedValueOnce(
      new ApiError(
        'This project tracks the maximum of 5 competitors. Remove one to add another.',
        409,
        '',
        undefined,
        { code: 'competitor_limit' },
      ),
    );
    renderSuggestions();
    await user.click(screen.getByRole('button', { name: 'Accept Northstar as a competitor' }));
    expect(
      await screen.findByText(
        'This project tracks the maximum of 5 competitors. Remove one to add another.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull();
  });

  it('re-reads only the suggestions after a rejection', async () => {
    const user = userEvent.setup({ delay: null });
    const { stale } = renderSuggestions();

    await user.click(screen.getByRole('button', { name: 'Reject Ledgerly as a competitor' }));

    await waitFor(() => expect(stale()).toEqual([false, true]));
  });

  it('reports a failed suggestions read without also claiming there are none', () => {
    const failed = {
      data: undefined,
      error: new Error('Gateway timeout'),
      isError: true,
      isSuccess: false,
      isFetching: false,
      refetch: vi.fn(),
    } as never;
    const answered = { data: [], isError: false, isSuccess: true } as never;

    const { unmount } = renderWithProviders(
      <CompetitorSuggestions projectId={projectId} tracked={0} suggestionsQuery={failed} />,
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(screen.queryByText('No suggested competitors yet.')).toBeNull();
    unmount();

    renderWithProviders(
      <CompetitorSuggestions projectId={projectId} tracked={0} suggestionsQuery={answered} />,
    );
    expect(screen.getByText('No suggested competitors yet.')).toBeVisible();
  });
});
