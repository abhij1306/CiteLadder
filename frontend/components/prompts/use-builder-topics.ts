'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import type { ProjectScope } from '@/lib/api/query-keys/scope';
import { topicsMutations } from '@/lib/api/topics';
import type { Topic, TopicPreview } from '@citeladder/contracts';
import {
  addProposals,
  planIsEmpty,
  planProblem,
  topicPlan,
  topicRows,
  withProposals,
  type TopicRow,
} from '@/lib/prompts/builder-topics';

/**
 * The "Review topics" step's state: the project's topics plus proposals,
 * edited locally. Proposing is a metered model call the person asks for;
 * nothing is written until Confirm applies the whole plan at once.
 */
export function useBuilderTopics({
  scope,
  topics,
}: Readonly<{
  scope: ProjectScope;
  topics: readonly Topic[];
}>) {
  const [edited, setEdited] = useState<TopicRow[] | null>(null);
  const [overflow, setOverflow] = useState<TopicPreview['overflow']>([]);
  const rows = edited ?? topicRows(topics);
  const plan = topicPlan(rows);

  const preview = useMutation({
    ...topicsMutations.preview(scope),
    onSuccess: (result) => {
      setEdited((current) => withProposals(current ?? topicRows(topics), result.topics));
      setOverflow(result.overflow);
    },
  });
  // The descriptor refreshes every read the confirmed topics change.
  const confirmation = topicsMutations.confirm(scope);
  const confirmPlan = useMutation({
    ...confirmation,
    onSuccess: async (...args) => {
      setEdited(null);
      setOverflow([]);
      await confirmation.onSuccess?.(...args);
    },
  });
  const confirm = {
    isPending: confirmPlan.isPending,
    error: confirmPlan.error,
    /** Apply the plan as it stands now. */
    mutateAsync: () => confirmPlan.mutateAsync(plan),
  };

  return {
    rows,
    setRows: setEdited,
    overflow,
    showOverflow: () => {
      setEdited(addProposals(rows, overflow));
      setOverflow([]);
    },
    pending: !planIsEmpty(plan),
    problem: planProblem(rows),
    preview,
    confirm,
  };
}
export type BuilderTopics = ReturnType<typeof useBuilderTopics>;
