'use client';

import { useQuery } from '@tanstack/react-query';
import { lazy, useEffect, type ReactNode } from 'react';

import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { Drawer } from '@/components/ui/drawer';
import { IslandUnavailable, LazyIsland } from '@/components/ui/lazy-island';
import { Stack } from '@/components/ui/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { queryKeys } from '@/lib/api/query-keys';
import { runsApi } from '@/lib/api/runs';
import { useActiveWorkspaceId } from '@/lib/project/project-context';

/**
 * The evidence card and the markdown renderer behind it are fetched when a
 * drawer opens, not with every screen that can open one: Visibility lists
 * source rows on every visit, and few of those visits open an answer.
 */
const loadEvidenceCard = () => import('@/components/runs/evidence-card');
const EvidenceCard = lazy(() =>
  loadEvidenceCard().then(({ EvidenceCard }) => ({ default: EvidenceCard })),
);

/**
 * What the drawer needs from whatever row opened it.
 *
 * Structural rather than `Execution`, because the same evidence is reached from
 * two places: a run's executions table, and the source-prompt rows in AI
 * visibility, whose rows are `VisibilityExecutionEvidence` and name the
 * execution as `task_id`. Both satisfy this shape, so neither has to fabricate
 * a full `Execution` to open the answer it already has a handle on.
 *
 * Everything past `id` labels the drawer; the answer, its outcome and the
 * analysis all come from the single-execution read (`/executions/{id}`), so
 * neither caller has to hold an answer to open one.
 */
export type EvidenceSubject = {
  /** The execution id. */
  id: string;
  prompt_text?: string;
  prompt_index?: number;
};

function EvidenceLoading() {
  return (
    <Stack gap="workspace" aria-label="Loading execution evidence">
      <Skeleton shape="line" />
      <Skeleton shape="block" />
      <Skeleton shape="chart" />
    </Stack>
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
  // Start the card's download beside the evidence read rather than after it.
  useEffect(() => {
    if (open) void loadEvidenceCard().catch(() => {});
  }, [open]);

  let evidenceBody: ReactNode;
  if (evidenceQuery.isError) {
    evidenceBody = (
      <ReadError
        {...readErrorProps(evidenceQuery)}
        fallback="Could not load this execution's evidence."
      />
    );
  } else if (evidenceQuery.isLoading || !evidenceQuery.data) {
    evidenceBody = <EvidenceLoading />;
  } else {
    evidenceBody = (
      <LazyIsland
        label="execution-evidence"
        defects="surface"
        loading={<EvidenceLoading />}
        failed={<IslandUnavailable message="Couldn't load evidence." />}
      >
        <EvidenceCard
          evidence={evidenceQuery.data}
          answerText={evidenceQuery.data.answer_text}
          promptText={execution?.prompt_text}
          promptIndex={execution?.prompt_index}
          isSearchSurface={evidenceQuery.data.logical_engine === 'google_ai_overview'}
          outcome={evidenceQuery.data.search_surface_outcome}
        />
      </LazyIsland>
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
      className="desktop:max-w-220"
      closeLabel="Close evidence drawer"
    >
      {evidenceBody}
    </Drawer>
  );
}
