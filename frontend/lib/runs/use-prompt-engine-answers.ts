import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { runsQueries } from '@/lib/api/runs';
import { useEngineCatalog } from '@/lib/providers/engines';

/**
 * The answers every engine gave one prompt in one run, for the evidence
 * drawer's Engine filter: the opened execution's siblings on the same prompt
 * that have an answer to show, and which of them the reader is on.
 *
 * The run and the prompt come from the opened execution's own evidence, so a
 * surface that holds only an execution id (AI Visibility's source rows) gets
 * the same choice as the run page. The choice belongs to the execution that
 * opened the drawer: opening another starts on that one.
 */
export function usePromptEngineAnswers({
  workspaceId,
  executionId,
  enabled,
}: Readonly<{ workspaceId: string | null; executionId: string | null; enabled: boolean }>) {
  const catalog = useEngineCatalog();
  const [picked, setPicked] = useState<Readonly<{ opened: string; id: string }> | null>(null);
  const opened = useQuery({
    ...runsQueries.execution(workspaceId, executionId),
    enabled: enabled && executionId !== null,
  });
  const run = useQuery({
    ...runsQueries.executions(workspaceId, opened.data?.audit_id ?? ''),
    enabled: enabled && opened.data !== undefined,
  });
  const promptIndex = opened.data?.prompt_index;
  const answers = (run.data ?? []).filter(
    (execution) => execution.prompt_index === promptIndex && execution.status === 'succeeded',
  );
  const pickedId = picked !== null && picked.opened === executionId ? picked.id : null;
  const activeId = answers.some((answer) => answer.id === pickedId) ? pickedId : executionId;
  return {
    activeId,
    /** One option per answer; a repeated engine is numbered ("ChatGPT 2"). */
    options: answers.map((answer, index) => {
      const label = catalog.label(answer.logical_engine);
      const earlier = answers
        .slice(0, index)
        .filter((other) => other.logical_engine === answer.logical_engine).length;
      return { value: answer.id, label: earlier ? `${label} ${earlier + 1}` : label };
    }),
    select: (id: string) => {
      if (executionId !== null) setPicked({ opened: executionId, id });
    },
  };
}
