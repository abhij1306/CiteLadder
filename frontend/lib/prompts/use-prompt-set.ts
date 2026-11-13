import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';

import { promptsMutations, promptsQueries } from '@/lib/api/prompts';
import type { PromptSet } from '@citeladder/contracts';
import { useProjectScope } from '@/lib/project/active-project-scope';

/**
 * Resolve the active project's prompt set.
 *
 * Prompts are scoped to a `PromptSet` under the active project.
 * The active project may already embed a prompt set (`project.prompt_sets`);
 * otherwise we list them and, if none exists, `ensurePromptSet` creates a
 * default one. Local create attempts serialize per project. The list query
 * is the source of truth once loaded so a freshly-created set is picked up.
 */
export function usePromptSet() {
  const { workspaceId, projectId, project } = useProjectScope();
  const scope = { workspaceId, projectId };

  const listQuery = useQuery(promptsQueries.sets(scope));
  // The embedded prompt sets render the table until the list (and its form bounds) loads.
  const embedded = project.prompt_sets;
  const sets = listQuery.data?.prompt_sets ?? embedded;
  const promptSet: PromptSet | null = sets[0] ?? null;

  const createMutation = useMutation(promptsMutations.ensureSet(scope));

  const ensurePromptSet = useCallback((): Promise<PromptSet> => {
    if (promptSet) return Promise.resolve(promptSet);
    return createMutation.mutateAsync();
  }, [promptSet, createMutation]);

  return {
    projectId,
    promptSet,
    prompts: promptSet?.prompts ?? [],
    /** Server-enforced bounds of the prompt forms; null until the list loads. */
    limits: listQuery.data?.limits ?? null,
    isLoading: listQuery.isLoading && !embedded.length,
    /** The list read's failure; null unless it failed. */
    error: listQuery.error,
    retry: () => void listQuery.refetch(),
    retrying: listQuery.isFetching,
    ensurePromptSet,
    isEnsuring: createMutation.isPending,
  };
}
