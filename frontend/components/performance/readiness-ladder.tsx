import { useQuery } from '@tanstack/react-query';
import { Circle, CircleCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { panelClasses } from '@/components/ui/panel';
import { Spinner } from '@/components/ui/spinner';
import { textRole } from '@/components/ui/typography';
import {
  performanceQueries,
  type ProjectReadiness,
  type ProjectReadinessStage,
} from '@/lib/api/performance';
import { pollReadiness } from '@/lib/performance/status';
import { useProjectScope } from '@/lib/project/active-project-scope';
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

function stageIndex(stage: ProjectReadinessStage): number {
  const index = LADDER.findIndex((step) => step.stage === stage);
  // Off-ladder states (nothing connected, a failed import) have no rung, so
  // no step is drawn as reached.
  return index;
}

/** A rung's mark, at the one glyph size: reached, in flight, or still ahead. */
function StepMark({ state }: Readonly<{ state: 'done' | 'active' | 'pending' }>) {
  if (state === 'done') return <Icon icon={CircleCheck} className="text-positive" />;
  if (state === 'active') return <Spinner className="text-info" />;
  return <Icon icon={Circle} className="text-line" />;
}

/**
 * The project's readiness, as ONE query.
 *
 * Both the ladder and the surfaces that ask "is this engine connected at all"
 * read the same cache entry, so they can never disagree about which stage a
 * project is on.
 */
export function useProjectReadiness() {
  const { workspaceId, projectId } = useProjectScope();
  return useQuery({
    ...performanceQueries.readiness({ workspaceId, projectId }),
    // While an import is in flight the answer changes on its own, so this
    // keeps asking rather than stranding the user on a stale stage.
    refetchInterval: (query) => pollReadiness(query.state.data?.stage),
  });
}

/** Where one rung sits relative to the furthest stage reached. */
function ladderStepState(index: number, reached: number): 'done' | 'active' | 'pending' {
  if (index < reached) return 'done';
  return index === reached ? 'active' : 'pending';
}

export function ReadinessLadder({
  data,
  sync,
}: Readonly<{
  data: ProjectReadiness | undefined;
  /** Starts a new sync, the recovery for a failed import; omitted while one runs. */
  sync?: () => void;
}>) {
  if (!data || data.stage === 'analysis_ready' || data.stage === 'not_connected') return null;

  if (data.stage === 'import_failed') {
    return (
      <MutationNotice
        notice={{ message: EXPLANATION.import_failed, retryable: false }}
        recovery={
          sync ? (
            <Button type="button" variant="secondary" onClick={sync}>
              Sync again
            </Button>
          ) : undefined
        }
      />
    );
  }

  const reached = stageIndex(data.stage);
  return (
    <Stack
      as="section"
      gap="compact"
      className={panelClasses()}
      aria-label="Data readiness"
      data-testid="readiness-ladder"
    >
      <Inline as="ol" gap="meta">
        {LADDER.map((step, index) => {
          const state = ladderStepState(index, reached);
          return (
            <Inline as="li" key={step.stage} aria-current={state === 'active' ? 'step' : undefined}>
              <StepMark state={state} />
              <span
                className={cn(
                  textRole('label', state === 'pending' ? 'text-ink-muted' : 'text-ink'),
                )}
              >
                {step.label}
              </span>
            </Inline>
          );
        })}
      </Inline>
      <p className={textRole('caption')}>
        {EXPLANATION[data.stage]}
        {data.imported_through
          ? ` Imported through ${formatWindowDate(data.imported_through)}.`
          : ''}
      </p>
    </Stack>
  );
}
