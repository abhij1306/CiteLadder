'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { EvidenceCard } from '@/components/runs/evidence-card';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { Drawer } from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/skeleton';
import { queryKeys } from '@/lib/api/query-keys';
import { runsApi } from '@/lib/api/runs';
import { useActiveWorkspaceId } from '@/lib/project/project-context';

/**
 * What the drawer needs from whatever row opened it.
 *
 * Structural rather than `Execution`, because the same evidence is reached from
 * two places: a run's executions table, and the source-prompt rows in AI
 * visibility, whose rows are `VisibilityExecutionEvidence` and name the
 * execution as `task_id`. Both satisfy this shape, so neither has to fabricate
 * a full `Execution` to open the answer it already has a handle on.
 *
 * Everything past `id` is a display fallback the drawer shows while the fetch
 * is in flight; the fetched evidence is what it actually renders.
 */
export type EvidenceSubject = {
  /** The execution id. */
  id: string;
  /**
   * The audit that owns the execution. Required when `answer_text` is absent:
   * `/executions/{id}` carries the ANALYSIS of an answer and not the answer
   * itself, so the text has to come from the audit's execution rows. A caller
   * that already holds the row passes `answer_text` instead and this is unused.
   */
  audit_id?: string;
  answer_text?: string;
  prompt_text?: string;
  prompt_index?: number;
  logical_engine?: string;
  search_surface_outcome?: string;
};

/**
 * The answer itself, for a caller that could not supply it.
 *
 * `/executions/{id}` carries the ANALYSIS of an answer — mentions, citations,
 * scores — and not the answer's text, which lives on the audit's execution
 * rows. The run detail screen already holds those rows and passes the text
 * straight in, so this stays idle there; a source row in AI visibility
 * summarises an answer without carrying one, so it resolves the text here.
 */
function useResolvedAnswer(execution: EvidenceSubject | null, open: boolean) {
  const workspaceId = useActiveWorkspaceId();
  const auditId = execution?.audit_id ?? '';
  const pending = open && execution?.answer_text === undefined && auditId !== '';
  const rows = useQuery({
    queryKey: queryKeys.runs.executions(auditId),
    queryFn: ({ signal }) => runsApi.listExecutions(auditId, { signal, workspaceId }),
    enabled: pending && workspaceId !== null,
  });
  const row = pending ? rows.data?.find((candidate) => candidate.id === execution?.id) : undefined;
  return {
    loading: pending && rows.isLoading,
    answerText: execution?.answer_text ?? row?.answer_text,
    outcome: execution?.search_surface_outcome ?? row?.search_surface_outcome,
  };
}

function EvidenceLoading() {
  return (
    <div className="grid gap-4" aria-label="Loading execution evidence">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-52 w-full" />
    </div>
  );
}

/** Persisted execution evidence shown without leaving the surface that opened it. */
export function ExecutionEvidenceDrawer({
  execution,
  open,
  onOpenChange,
}: Readonly<{
  execution: EvidenceSubject | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const workspaceId = useActiveWorkspaceId();
  const evidenceQuery = useQuery({
    queryKey: queryKeys.runs.execution(execution?.id ?? ''),
    queryFn: ({ signal }) => runsApi.getExecution(execution?.id ?? '', { signal, workspaceId }),
    enabled: open && execution !== null && workspaceId !== null,
  });
  const answer = useResolvedAnswer(execution, open);

  let evidenceBody: ReactNode;
  if (evidenceQuery.isError) {
    evidenceBody = (
      <ReadError
        {...readErrorProps(evidenceQuery)}
        fallback="Could not load this execution's evidence."
      />
    );
  } else if (evidenceQuery.isLoading || !evidenceQuery.data || answer.loading) {
    evidenceBody = <EvidenceLoading />;
  } else {
    evidenceBody = (
      <EvidenceCard
        evidence={evidenceQuery.data}
        answerText={answer.answerText}
        promptText={execution?.prompt_text}
        promptIndex={execution?.prompt_index}
        isSearchSurface={execution?.logical_engine === 'google_ai_overview'}
        outcome={answer.outcome}
      />
    );
  }

  const description =
    execution?.prompt_index === undefined ? undefined : `Prompt #${execution.prompt_index + 1}`;

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Execution evidence"
      description={description}
      className="sm:max-w-220"
      closeLabel="Close evidence drawer"
    >
      {evidenceBody}
    </Drawer>
  );
}
