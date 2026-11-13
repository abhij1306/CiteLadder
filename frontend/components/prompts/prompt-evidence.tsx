import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { ExecutionEvidenceDrawer } from '@/components/runs/execution-evidence-drawer';
import { runsQueries } from '@/lib/api/runs';
import { useProjectScope } from '@/lib/project/active-project-scope';

/** Where the latest run asked one prompt: the run, and the prompt's place in it. */
export type PromptAnswerRef = Readonly<{ auditId: string; promptIndex: number }>;

type Opened = PromptAnswerRef & Readonly<{ promptText: string }>;

/**
 * The evidence drawer for a prompt row: the answers the latest run got for
 * that prompt. It opens on the run's first succeeded answer to the prompt;
 * the drawer's own Engine filter reaches the others. The run's executions are
 * read only once a row asks.
 */
export function usePromptEvidence(): Readonly<{
  open: (prompt: Opened) => void;
  drawer: ReactNode;
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
  // The run was read and holds no answer to this prompt, or could not be read.
  const missing = run.isError || (run.data !== undefined && !answer);
  return {
    open: setOpened,
    drawer: (
      <ExecutionEvidenceDrawer
        execution={
          opened && answer
            ? { id: answer.id, prompt_text: opened.promptText, prompt_index: opened.promptIndex }
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
