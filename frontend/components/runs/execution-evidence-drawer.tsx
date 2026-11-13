import { useQuery } from '@tanstack/react-query';
import { lazy, useEffect, type ReactNode } from 'react';

import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { choiceFilter } from '@/components/ui/all-filters';
import { Drawer } from '@/components/ui/drawer';
import { FilterControls } from '@/components/ui/filter-bar';
import { IslandUnavailable, LazyIsland } from '@/components/ui/lazy-island';
import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { Skeleton } from '@/components/ui/skeleton';
import { runsQueries } from '@/lib/api/runs';
import { ICONS } from '@/lib/icons';
import { usePromptEngineAnswers } from '@/lib/runs/use-prompt-engine-answers';
import { useProjectScope } from '@/lib/project/active-project-scope';

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
      <Skeleton lines={1} />
      <Skeleton variant="block" />
      <Skeleton variant="chart" />
    </Stack>
  );
}

/** Persisted execution evidence shown without leaving the surface that opened it. */
export function ExecutionEvidenceDrawer({
  execution,
  open,
  onOpenChange,
  unavailable,
}: Readonly<{
  execution: EvidenceSubject | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Said in place of the evidence when the opener found no answer to show. */
  unavailable?: string;
}>) {
  const { workspaceId } = useProjectScope();
  const engines = usePromptEngineAnswers({
    workspaceId,
    executionId: execution?.id ?? null,
    enabled: open,
  });
  const evidenceQuery = useQuery({
    ...runsQueries.execution(workspaceId, engines.activeId),
    enabled: open && engines.activeId !== null,
  });
  // Start the card's download beside the evidence read rather than after it.
  useEffect(() => {
    if (open) void loadEvidenceCard().catch(() => {});
  }, [open]);

  let evidenceBody: ReactNode;
  if (unavailable) {
    evidenceBody = <QueryState kind="empty" icon={ICONS.runs} heading={unavailable} />;
  } else if (evidenceQuery.isError) {
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
      width="wide"
      closeLabel="Close evidence drawer"
    >
      {/* One engine's answer has nothing to choose; the filter appears with a second. */}
      {engines.options.length > 1 && engines.activeId !== null ? (
        <Stack gap="workspace">
          <div className="flex min-w-0">
            <FilterControls
              filters={[
                choiceFilter({
                  id: 'engine',
                  label: 'Engine',
                  value: engines.activeId,
                  defaultValue: engines.activeId,
                  groups: [{ options: engines.options }],
                  onChange: engines.select,
                }),
              ]}
            />
          </div>
          {evidenceBody}
        </Stack>
      ) : (
        evidenceBody
      )}
    </Drawer>
  );
}
