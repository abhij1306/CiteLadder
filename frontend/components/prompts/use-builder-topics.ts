'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { topicsApi } from '@/lib/api/topics';
import type { Topic, TopicPreview } from '@/lib/api/types';
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
  projectId,
  workspaceId,
  topics,
  onConfirmed,
}: Readonly<{
  projectId: string;
  workspaceId: string;
  topics: readonly Topic[];
  /** Refreshes every read the confirmed topics change. */
  onConfirmed: () => Promise<void>;
}>) {
  const [edited, setEdited] = useState<TopicRow[] | null>(null);
  const [overflow, setOverflow] = useState<TopicPreview['overflow']>([]);
  const rows = edited ?? topicRows(topics);
  const plan = topicPlan(rows);

  const preview = useMutation({
    mutationFn: () => topicsApi.preview(projectId, { workspaceId }),
    onSuccess: (result) => {
      setEdited((current) => withProposals(current ?? topicRows(topics), result.topics));
      setOverflow(result.overflow);
    },
  });
  const confirm = useMutation({
    mutationFn: () => topicsApi.confirm(projectId, plan, { workspaceId }),
    onSuccess: async () => {
      setEdited(null);
      setOverflow([]);
      await onConfirmed();
    },
  });

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
