'use client';

import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { panelClasses } from '@/components/ui/panel';
import { Spinner } from '@/components/ui/spinner';
import { textRole } from '@/components/ui/typography';
import {
  performanceApi,
  type ProjectReadiness,
  type ProjectReadinessStage,
} from '@/lib/api/performance';
import { useActiveWorkspaceId } from '@/lib/project/project-context';
import { queryKeys } from '@/lib/api/query-keys';
import { formatWindowDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Where a freshly connected project's data actually is.
 *
 * A first connect imports a year of history and then derives it, which takes
 * long enough that one undifferentiated spinner — or a dashboard that renders
 * empty — reads as broken. The ladder names the stages instead, so the user
 * can see their own GSC/GA4 numbers the moment the first chunk lands while
 * CiteLadder's own analysis is explicitly still computing.
 *
 * The stages are distinct STATES, not a percentage. In
 * particular `import_failed` is off the ladder rather than a slower
 * `importing`: nothing further is coming, and a spinner there would never
 * stop. Once analysis is ready the ladder has nothing left to say and
 * disappears — a permanent "everything is fine" banner is noise.
 */

const LADDER: readonly { stage: ProjectReadinessStage; label: string }[] = [
  { stage: 'connected', label: 'Connected' },
  { stage: 'importing', label: 'Importing history' },
  { stage: 'core_data_ready', label: 'Search data ready' },
  { stage: 'analysis_ready', label: 'Analysis ready' },
] as const;

/** What the user should understand, in one line, at each stage. */
/** `not_connected` belongs to the data source setup, which can act on it. */
const EXPLANATION: Record<Exclude<ProjectReadinessStage, 'not_connected'>, string> = {
  connected: 'Connected. The first history import has not started yet.',
  importing:
    'Importing your history. Numbers below fill in as each chunk lands — they are not final yet.',
  import_failed:
    'The history import finished without importing anything. Start a new sync to retry.',
  core_data_ready:
    'Your Search Console and Analytics numbers are ready. CiteLadder’s own analysis is still computing.',
  analysis_ready: 'Everything is ready.',
};

/**
 * Stages nothing will advance on its own.
 *
 * Everything else is work in flight — including `core_data_ready`, where the
 * search numbers have landed but CiteLadder's analysis is still computing.
 * Polling only the earlier rungs left the ladder stuck one step short of
 * ready until the reader reloaded the page.
 */
const SETTLED_STAGES: ReadonlySet<ProjectReadinessStage> = new Set([
  'analysis_ready',
  'import_failed',
  'not_connected',
]);

function stageIndex(stage: ProjectReadinessStage): number {
  const index = LADDER.findIndex((step) => step.stage === stage);
  // Off-ladder states (nothing connected, a failed import) have no rung, so
  // no step is drawn as reached.
  return index;
}

function StepMark({ state }: Readonly<{ state: 'done' | 'active' | 'pending' }>) {
  if (state === 'done') {
    return (
      <span className="bg-success-bg text-success-text inline-flex size-5 shrink-0 items-center justify-center rounded-full">
        <Check className="size-3" aria-hidden />
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span className="border-info-border text-info-text inline-flex size-5 shrink-0 items-center justify-center rounded-full border">
        <Spinner size="sm" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="border-border-strong inline-flex size-5 shrink-0 rounded-full border"
    />
  );
}

/**
 * The project's readiness, as ONE query.
 *
 * Both the ladder and the surfaces that ask "is this engine connected at all"
 * read the same cache entry, so they can never disagree about which stage a
 * project is on.
 */
export function useProjectReadiness(projectId: string | null) {
  const workspaceId = useActiveWorkspaceId();
  return useQuery({
    queryKey: queryKeys.performance.readiness(projectId ?? ''),
    queryFn: ({ signal }) => performanceApi.getReadiness(projectId!, { signal, workspaceId }),
    enabled: Boolean(projectId && workspaceId),
    // While an import is in flight the answer changes on its own, so this
    // keeps asking rather than stranding the user on a stale stage.
    refetchInterval: (query) => {
      const stage = query.state.data?.stage;
      if (stage === undefined) return false;
      return SETTLED_STAGES.has(stage) ? false : 15_000;
    },
  });
}

/** Where one rung sits relative to the furthest stage reached. */
function ladderStepState(index: number, reached: number): 'done' | 'active' | 'pending' {
  if (index < reached) return 'done';
  return index === reached ? 'active' : 'pending';
}

export function ReadinessLadder({ data }: Readonly<{ data: ProjectReadiness | undefined }>) {
  if (!data || data.stage === 'analysis_ready' || data.stage === 'not_connected') return null;

  if (data.stage === 'import_failed') {
    return <Alert tone="danger">{EXPLANATION.import_failed}</Alert>;
  }

  const reached = stageIndex(data.stage);
  return (
    <section
      className={cn(panelClasses({ tone: 'panel', pad: 'compact' }), 'grid gap-2')}
      aria-label="Data readiness"
      data-testid="readiness-ladder"
    >
      <ol className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {LADDER.map((step, index) => {
          const state = ladderStepState(index, reached);
          return (
            <li
              key={step.stage}
              className="flex items-center gap-2"
              aria-current={state === 'active' ? 'step' : undefined}
            >
              <StepMark state={state} />
              <span
                className={cn(
                  textRole('label', state === 'pending' ? 'text-muted' : 'text-foreground'),
                )}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
      <p className={textRole('caption')}>
        {EXPLANATION[data.stage]}
        {data.imported_through
          ? ` Imported through ${formatWindowDate(data.imported_through)}.`
          : ''}
      </p>
    </section>
  );
}
