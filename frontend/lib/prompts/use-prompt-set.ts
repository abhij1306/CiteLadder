'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';

import { promptsMutations, promptsQueries } from '@/lib/api/prompts';
import type { PromptSet } from '@citeladder/contracts';
import { useActiveProject, useActiveWorkspaceId } from '@/lib/project/project-context';

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
  const project = useActiveProject();
  const workspaceId = useActiveWorkspaceId();
  const projectId = project?.id ?? null;
  // Disabled until a project is active, so the empty id never reaches the API.
  const scope = { workspaceId, projectId: projectId ?? '' };
  const available = Boolean(projectId && workspaceId);

  const listQuery = useQuery({
    ...promptsQueries.sets(scope),
    enabled: available,
    // Seed from the embedded prompt sets so the table can render immediately.
    initialData: project?.prompt_sets?.length ? project.prompt_sets : undefined,
  });

  const sets = listQuery.data ?? [];
  const promptSet: PromptSet | null = sets[0] ?? null;

  const createMutation = useMutation(promptsMutations.ensureSet(scope));

  const ensurePromptSet = useCallback((): Promise<PromptSet> => {
    if (promptSet) return Promise.resolve(promptSet);
    if (!available) return Promise.reject(new Error('Project is not available.'));
    return createMutation.mutateAsync();
  }, [promptSet, available, createMutation]);

  return {
    projectId,
    promptSet,
    prompts: promptSet?.prompts ?? [],
    isLoading: Boolean(projectId) && listQuery.isLoading,
    /** The list read's failure; null unless it failed. */
    error: listQuery.error,
    retry: () => void listQuery.refetch(),
    retrying: listQuery.isFetching,
    ensurePromptSet,
    isEnsuring: createMutation.isPending,
  };
}
