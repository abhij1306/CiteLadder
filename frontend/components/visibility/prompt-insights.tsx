import { useMutation, type UseQueryResult } from '@tanstack/react-query';

import { Callout } from '@/components/ui/callout';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { textRole } from '@/components/ui/typography';
import { Inline, Stack } from '@/components/ui/layout';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import { QueryState } from '@/components/ui/query-state';
import { ReadError } from '@/components/ui/read-error';
import type { ObservedCompetitor } from '@citeladder/contracts';
import { Button } from '@/components/ui/button';
import { visibilityMutations } from '@/lib/api/visibility-queries';
import { useActiveWorkspaceId, useWorkspaceCapability } from '@/lib/project/project-context';

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
  const workspaceId = useActiveWorkspaceId();
  const acceptMutation = useMutation(
    visibilityMutations.acceptCompetitorSuggestion({ workspaceId, projectId }),
  );
  // Adding a competitor edits the project; a role without write reads the list.
  const canWrite = useWorkspaceCapability('write');

  return (
    <Card aria-labelledby="competitor-suggestions">
      <CardHeader>
        <CardTitle id="competitor-suggestions">Competitor suggestions</CardTitle>
        <CardDescription>
          Observed repeatedly in third-party citations. Verify relevance before adding.
        </CardDescription>
      </CardHeader>
      <Stack>
        <SuggestionRows
          suggestionsQuery={suggestionsQuery}
          adding={acceptMutation.isPending}
          onAdd={canWrite ? (candidateId) => acceptMutation.mutate(candidateId) : undefined}
        />
        {acceptMutation.isError ? (
          <Callout tone="negative">Could not add that competitor. Try again.</Callout>
        ) : null}
      </Stack>
    </Card>
  );
}

function SuggestionRows({
  suggestionsQuery,
  adding,
  onAdd,
}: Readonly<{
  suggestionsQuery: UseQueryResult<ObservedCompetitor[], unknown>;
  adding: boolean;
  /** Adds a candidate to the roster; omitted for a role that may not. */
  onAdd?: (candidateId: string) => void;
}>) {
  return (
    <>
      {suggestionsQuery.isError ? (
        <ReadError
          error={suggestionsQuery.error}
          fallback="Could not load competitor suggestions."
          onRetry={() => void suggestionsQuery.refetch()}
          pending={suggestionsQuery.isFetching}
        />
      ) : null}
      {suggestionsQuery.data?.length ? (
        <ul className={ledgerClasses()}>
          {suggestionsQuery.data.map((candidate) => (
            <Inline
              as="li"
              key={candidate.id}
              className={ledgerItemClasses('type-body flex-wrap justify-between')}
            >
              <Stack gap="tight">
                <p className={textRole('itemTitle')}>{candidate.name}</p>
                <p className="type-caption">
                  {candidate.domain} · {candidate.prompt_count} prompts / {candidate.engine_count}{' '}
                  engines
                </p>
              </Stack>
              {onAdd ? (
                <Button variant="secondary" onClick={() => onAdd(candidate.id)} disabled={adding}>
                  Add competitor
                </Button>
              ) : null}
            </Inline>
          ))}
        </ul>
      ) : null}
      {/* Only an answered, empty list is "none yet"; a failed read says so above. */}
      {suggestionsQuery.isSuccess && !suggestionsQuery.data.length ? (
        <QueryState kind="empty" inline message="No repeated citation candidates yet." />
      ) : null}
    </>
  );
}
