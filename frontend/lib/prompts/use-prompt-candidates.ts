'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { humanizeApiError } from '@/lib/api/errors';
import { promptsMutations, promptsQueries } from '@/lib/api/prompts';
import type {
  PromptCandidate,
  PromptCandidateReviewResponse,
  PromptSet,
} from '@citeladder/contracts';

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
 * Pending generated candidates for a prompt set, plus accept/reject. A
 * review refreshes the library through its descriptor; `onAccepted` is the
 * screen's own reaction to newly tracked prompts.
 */
export function usePromptCandidates({
  projectId,
  promptSet,
  workspaceId,
  onAccepted,
}: Readonly<{
  projectId: string;
  promptSet: PromptSet | null;
  workspaceId: string;
  onAccepted: () => void;
}>) {
  const promptSetId = promptSet?.id ?? null;
  const scope = { workspaceId, projectId };
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery({
    ...promptsQueries.candidates(scope, promptSetId),
    enabled: Boolean(promptSetId),
  });
  const candidates: PromptCandidate[] = query.data ?? [];

  const review = promptsMutations.reviewCandidates(scope);
  const mutation = useMutation({
    ...review,
    onMutate: () => setNotice(null),
    onSuccess: async (result, ...rest) => {
      setNotice(reviewNotice(result));
      await review.onSuccess?.(result, ...rest);
      if (result.accepted.length) onAccepted();
    },
  });
  const submit = (input: { accept_ids: string[] } | { reject_ids: string[] }) => {
    if (promptSetId) mutation.mutate({ promptSetId, input });
  };

  return {
    candidates,
    isLoading: Boolean(promptSetId && workspaceId) && query.isPending,
    loadError: query.isError ? humanizeApiError(query.error).message : undefined,
    retry: () => void query.refetch(),
    accept: (ids: string[]) => submit({ accept_ids: ids }),
    reject: (ids: string[]) => submit({ reject_ids: ids }),
    isReviewing: mutation.isPending,
    error: mutation.isError ? humanizeApiError(mutation.error).message : undefined,
    notice,
    clearNotice: () => setNotice(null),
  };
}
