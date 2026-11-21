import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { AnswerDialog } from '@/components/runs/answer-dialog';
import { runsQueries } from '@/lib/api/runs';
import { useProjectScope } from '@/lib/project/active-project-scope';

export type PromptAnswerRef = Readonly<{ auditId: string; promptIndex: number }>;

type Opened = PromptAnswerRef & Readonly<{ promptId: string; promptText: string }>;

export function usePromptEvidence(): Readonly<{
  open: (prompt: Opened) => void;
  dialog: ReactNode;
}> {
  const { workspaceId } = useProjectScope();
  const [opened, setOpened] = useState<Opened | null>(null);
  const run = useQuery({
    ...runsQueries.executions(workspaceId, opened?.auditId ?? ''),
    enabled: opened !== null,
  });
  const answer = run.data?.find(
    (execution) =>
      execution.prompt_index === opened?.promptIndex && execution.status === 'succeeded',
  );
  const missing = run.isError || (run.data !== undefined && !answer);
  return {
    open: setOpened,
    dialog: (
      <AnswerDialog
        execution={
          opened
            ? {
                id: answer?.id ?? null,
                prompt_text: opened.promptText,
                prompt_index: opened.promptIndex,
                prompt_id: opened.promptId,
              }
            : null
        }
        open={opened !== null}
        unavailable={missing ? 'The latest run has no answer to show for this prompt.' : undefined}
        onOpenChange={(next) => {
          if (!next) setOpened(null);
        }}
      />
    ),
  };
}
