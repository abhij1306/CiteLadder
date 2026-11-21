import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { runsQueries } from '@/lib/api/runs';
import { useEngineCatalog } from '@/lib/providers/engines';

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
    shown: run.data?.find((execution) => execution.id === activeId) ?? null,
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
