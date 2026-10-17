'use client';

import { useState, type ReactNode } from 'react';

import type { PromptGenerateInput } from '@/lib/api/prompts';
import type { PromptGenerateResponse, Topic } from '@/lib/api/types';

import { GeneratePromptsDialogView } from './generate-prompts-dialog-view';

import { MAX_GENERATION_COUNT } from '@/lib/config/prompts';

export function GeneratePromptsDialog({
  open,
  onOpenChange,
  topics,
  defaultTopicId,
  onGenerate,
  isGenerating,
  error,
  result,
  review,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topics: Topic[];
  defaultTopicId?: string | null;
  onGenerate: (input: PromptGenerateInput) => Promise<void> | void;
  isGenerating?: boolean;
  error?: unknown;
  result?: PromptGenerateResponse | null;
  review?: ReactNode;
}>) {
  const initialTopics = () => new Set(defaultTopicId ? [defaultTopicId] : []);
  const [count, setCount] = useState('10');
  // No selection means every topic.
  const [topicIds, setTopicIds] = useState<ReadonlySet<string>>(initialTopics);
  const [previousOpen, setPreviousOpen] = useState(open);
  if (open !== previousOpen) {
    setPreviousOpen(open);
    if (open) setTopicIds(initialTopics());
  }
  const toggleTopic = (id: string, checked: boolean) =>
    setTopicIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  const parsedCount = Number(count);
  const countValid =
    Number.isInteger(parsedCount) && parsedCount >= 1 && parsedCount <= MAX_GENERATION_COUNT;
  return (
    <GeneratePromptsDialogView
      open={open}
      onOpenChange={onOpenChange}
      topics={topics}
      count={count}
      selectedTopicIds={topicIds}
      setCount={setCount}
      toggleTopic={toggleTopic}
      countValid={countValid}
      onSubmit={() => {
        if (!countValid) return;
        // Only ids still present count; a deleted topic drops out silently.
        const ids = topics.map((topic) => topic.id).filter((id) => topicIds.has(id));
        void onGenerate({ count: parsedCount, topic_ids: ids });
      }}
      isGenerating={isGenerating}
      error={error}
      result={result}
      maxCount={MAX_GENERATION_COUNT}
      review={review}
    />
  );
}
