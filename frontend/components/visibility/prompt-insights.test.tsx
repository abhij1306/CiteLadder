import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { queryKeys } from '@/lib/api/query-keys';
import { renderWithProviders } from '@/test/render';

import { CompetitorSuggestions } from './prompt-insights';

const { acceptCompetitorSuggestion } = vi.hoisted(() => ({
  acceptCompetitorSuggestion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/api/visibility', () => ({
  visibilityApi: { acceptCompetitorSuggestion },
}));

afterEach(() => vi.clearAllMocks());

describe('CompetitorSuggestions', () => {
  it('refreshes company facts after accepting a competitor', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const user = userEvent.setup({ delay: null });
    const suggestionsQuery = {
      data: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          audit_id: '33333333-3333-4333-8333-333333333333',
          name: 'Northstar',
          domain: 'northstar.test',
          qualification_reason: 'Repeated third-party citations',
          prompt_count: 3,
          engine_count: 2,
          market_relevant: true,
          analyzer_version: 'competitor-v1',
          source_analysis_ids: [],
        },
      ],
      isError: false,
      isLoading: false,
    } as never;
    const { queryClient } = renderWithProviders(
      <CompetitorSuggestions projectId={projectId} suggestionsQuery={suggestionsQuery} />,
    );
    const facts = queryKeys.projects.commandCenter({ workspaceId: null, projectId });
    const suggestions = queryKeys.visibility.competitorSuggestions({
      workspaceId: null,
      projectId,
    });
    for (const key of [facts, suggestions]) queryClient.setQueryData(key, {});
    const stale = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;

    await user.click(screen.getByRole('button', { name: 'Add competitor' }));

    // The company facts and the suggestion list both re-read; the accepted
    // competitor leaves the list.
    await waitFor(() => expect([facts, suggestions].map(stale)).toEqual([true, true]));
  });
});
