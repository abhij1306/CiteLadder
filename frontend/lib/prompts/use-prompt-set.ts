'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { promptsApi } from '@/lib/api/prompts';
import { queryKeys } from '@/lib/api/query-keys';
import type { PromptSet } from '@/lib/api/types';
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
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: projectId ? queryKeys.prompts.sets(projectId) : ['prompts', 'sets', 'none'],
    queryFn: ({ signal }) =>
      promptsApi.listPromptSets(projectId as string, { signal, workspaceId }),
    enabled: Boolean(projectId && workspaceId),
    // Seed from the embedded prompt sets so the table can render immediately.
    initialData: project?.prompt_sets?.length ? project.prompt_sets : undefined,
  });

  const sets = listQuery.data ?? [];
  const promptSet: PromptSet | null = sets[0] ?? null;

  const createMutation = useMutation({
    scope: { id: `ensure-prompt-set:${workspaceId}:${projectId}` },
    mutationFn: async () => {
      if (!projectId || !workspaceId) throw new Error('Project is not available.');
      // Resolve the list before interpreting an empty cache as an empty project.
      // fetchQuery also joins an initial read already in flight.
      const available = await queryClient.fetchQuery({
        queryKey: queryKeys.prompts.sets(projectId),
        queryFn: ({ signal }) => promptsApi.listPromptSets(projectId, { signal, workspaceId }),
        staleTime: 0,
      });
      if (available[0]) return available[0];
      return promptsApi.createPromptSet(
        { project_id: projectId as string, name: 'Default prompt set' },
        { workspaceId },
      );
    },
    onSuccess: async (created) => {
      if (projectId) {
        queryClient.setQueryData<PromptSet[]>(queryKeys.prompts.sets(projectId), (prev) =>
          prev?.length ? prev : [created],
        );
        await queryClient.invalidateQueries({ queryKey: queryKeys.prompts.sets(projectId) });
      }
    },
  });

  const ensurePromptSet = useCallback((): Promise<PromptSet> => {
    if (promptSet) return Promise.resolve(promptSet);
    return createMutation.mutateAsync();
  }, [promptSet, createMutation]);

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
