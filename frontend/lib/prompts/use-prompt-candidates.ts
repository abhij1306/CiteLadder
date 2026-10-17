'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { humanizeApiError } from '@/lib/api/errors';
import { promptsApi } from '@/lib/api/prompts';
import { queryKeys } from '@/lib/api/query-keys';
import type { PromptCandidate, PromptCandidateReviewResponse, PromptSet } from '@/lib/api/types';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function reviewNotice(result: PromptCandidateReviewResponse): string {
  const parts: string[] = [];
  if (result.accepted.length) parts.push(`${plural(result.accepted.length, 'prompt')} now tracked`);
  if (result.rejected_count) parts.push(`${result.rejected_count} rejected`);
  if (result.dropped_duplicates)
    parts.push(`${plural(result.dropped_duplicates, 'duplicate')} already tracked`);
  if (result.unavailable_count) parts.push(`${result.unavailable_count} no longer pending`);
  return parts.length ? `${parts.join('; ')}.` : 'Nothing changed.';
}

/**
 * Pending generated candidates for a prompt set, plus accept/reject.
 * Accepting adds tracked prompts, so `onReviewed` refreshes the library.
 */
export function usePromptCandidates({
  promptSet,
  workspaceId,
  onReviewed,
}: Readonly<{
  promptSet: PromptSet | null;
  workspaceId: string;
  onReviewed: () => Promise<void>;
}>) {
  const promptSetId = promptSet?.id ?? null;
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery({
    queryKey: promptSetId
      ? queryKeys.prompts.candidates(promptSetId)
      : ['prompts', 'candidates', 'none'],
    queryFn: ({ signal }) =>
      promptsApi.listCandidates(promptSetId as string, { signal, workspaceId }),
    enabled: Boolean(promptSetId && workspaceId),
  });
  const candidates: PromptCandidate[] = query.data ?? [];

  const refresh = async () => {
    if (promptSetId)
      await queryClient.invalidateQueries({ queryKey: queryKeys.prompts.candidates(promptSetId) });
  };

  const mutation = useMutation({
    mutationFn: (input: { accept_ids?: string[]; reject_ids?: string[] }) =>
      promptsApi.reviewCandidates(promptSetId as string, input, { workspaceId }),
    onMutate: () => setNotice(null),
    onSuccess: async (result) => {
      setNotice(reviewNotice(result));
      await refresh();
      if (result.accepted.length) await onReviewed();
    },
  });

  return {
    candidates,
    isLoading: Boolean(promptSetId && workspaceId) && query.isPending,
    loadError: query.isError ? humanizeApiError(query.error).message : undefined,
    refresh,
    accept: (ids: string[]) => mutation.mutate({ accept_ids: ids }),
    reject: (ids: string[]) => mutation.mutate({ reject_ids: ids }),
    isReviewing: mutation.isPending,
    error: mutation.isError ? humanizeApiError(mutation.error).message : undefined,
    notice,
    clearNotice: () => setNotice(null),
  };
}
