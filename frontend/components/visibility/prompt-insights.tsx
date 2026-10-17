'use client';

import { useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { Alert } from '@/components/ui/alert';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses } from '@/components/ui/workspace';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { ReadError } from '@/components/ui/read-error';
import type { ObservedCompetitor } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { queryKeys } from '@/lib/api/query-keys';
import { visibilityApi } from '@/lib/api/visibility';
import { useActiveWorkspaceId } from '@/lib/project/project-context';

/**
 * Competitors the runs observed but the project does not yet track, with the
 * action that adds one to the roster.
 *
 * This module also used to own the Visibility dashboard's "Prompt analysis"
 * card. Prompt results now live on the prompt rows in the Prompts section,
 * where the prompt is the object rather than a detail of a measurement.
 */
export function CompetitorSuggestions({
  projectId,
  suggestionsQuery,
}: Readonly<{
  projectId: string;
  suggestionsQuery: UseQueryResult<ObservedCompetitor[], unknown>;
}>) {
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const acceptMutation = useMutation({
    mutationFn: (candidateId: string) =>
      visibilityApi.acceptCompetitorSuggestion(projectId, candidateId, { workspaceId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.visibility.competitorSuggestions(projectId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects.commandCenter(projectId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.visibility.all });
    },
  });

  return (
    <div className="flex flex-col gap-3 pt-2">
      <div className="grid gap-0.5">
        <h3 className={textRole('sectionTitle')}>Competitor suggestions</h3>
        <p className="type-caption">
          Observed repeatedly in third-party citations. Verify relevance before adding.
        </p>
      </div>
      {suggestionsQuery.isError ? (
        <ReadError
          error={suggestionsQuery.error}
          fallback="Could not load competitor suggestions."
          onRetry={() => void suggestionsQuery.refetch()}
          pending={suggestionsQuery.isFetching}
        />
      ) : null}
      {suggestionsQuery.data?.length ? (
        <ul className={ledgerClasses('boxed')}>
          {suggestionsQuery.data.map((candidate) => (
            <li
              key={candidate.id}
              className="type-body flex flex-wrap items-center justify-between gap-2 px-4 py-3"
            >
              <div className="grid gap-0.5">
                <p className={textRole('itemTitle')}>{candidate.name}</p>
                <p className="type-caption">
                  {candidate.domain} · {candidate.prompt_count} prompts / {candidate.engine_count}{' '}
                  engines
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => acceptMutation.mutate(candidate.id)}
                disabled={acceptMutation.isPending}
              >
                Add competitor
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {!suggestionsQuery.data?.length && !suggestionsQuery.isLoading ? (
        <InlineEmpty>No repeated citation candidates yet.</InlineEmpty>
      ) : null}
      {acceptMutation.isError ? (
        <Alert tone="danger">Could not add that competitor. Try again.</Alert>
      ) : null}
    </div>
  );
}
