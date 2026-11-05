import { Check, X } from 'lucide-react';

import { cn } from '@/lib/utils';

export type StepStatus = 'pending' | 'running' | 'done' | 'failed';

export type Step = Readonly<{
  /** Stable key; the label when omitted. */
  id?: string;
  label: string;
  status: StepStatus;
  /** Elapsed or finishing time, already formatted ("0:42"). */
  time?: string;
  /** One line: a count while running, the cause and next step on failure. */
  detail?: string;
}>;

/** The status word a screen reader hears after each label. */
const STATUS_WORD = {
  pending: 'Waiting',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
} as const satisfies Record<StepStatus, string>;

const LABEL_INK = {
  pending: 'text-ink-muted',
  running: 'text-ink font-medium',
  done: 'text-ink',
  failed: 'text-ink',
} as const satisfies Record<StepStatus, string>;

const ICON_BOX = 'grid size-5 place-items-center rounded-full';

/** The 20px mark on the rail: a check, an x, a turning ring or an empty ring. */
function StepIcon({ status }: Readonly<{ status: StepStatus }>) {
  if (status === 'done') {
    return (
      <span className={cn(ICON_BOX, 'bg-positive text-surface')}>
        <Check className="size-3" aria-hidden />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className={cn(ICON_BOX, 'bg-negative text-surface')}>
        <X className="size-3" aria-hidden />
      </span>
    );
  }
  if (status === 'running') {
    // The app's one spinner turn: it slows under reduced motion rather than
    // stopping, since a still ring would read as a stuck step.
    return (
      <span className={ICON_BOX}>
        <svg viewBox="0 0 20 20" className="size-5" fill="none" aria-hidden>
          {/* The ring turns inside the svg, so it never draws outside its box. */}
          <g className="animate-spinner origin-center [transform-box:view-box]">
            <circle cx="10" cy="10" r="8" strokeWidth="2.5" className="stroke-chart-grid" />
            <path
              d="M10 2a8 8 0 0 1 8 8"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="stroke-ink"
            />
          </g>
        </svg>
      </span>
    );
  }
  return <span className={cn(ICON_BOX, 'bg-surface border-line-control border')} />;
}

/**
 * StepList — the app's one checklist for the steps of a run (a prompt run, a
 * crawl, an import, onboarding research): each step's mark, label, one line
 * of detail and its time.
 *
 * Done is a check on `positive`; failed an x on `negative` with the cause as
 * its detail in `negative`; running a turning `ink` ring on a `chart-grid`
 * track and `aria-current="step"`; pending an empty `line-control` ring with
 * an empty time slot (no lone dash: the status word names the state). A 1px
 * `line` connector joins the marks. Every label carries
 * its status word for screen readers, so the list reads without the marks.
 *
 * Callers own the language: labels and details arrive as customer copy, never
 * as backend tokens. Keep a run to about eight steps (group them), and keep a
 * failed step visible after the run moves on.
 */
export function StepList({
  steps,
  label,
}: Readonly<{
  steps: readonly Step[];
  /** What the steps are of ("Discovering your brand"). */
  label: string;
}>) {
  return (
    <ol aria-label={label} className="m-0 flex list-none flex-col p-0">
      {steps.map((step, index) => (
        <li
          key={step.id ?? step.label}
          aria-current={step.status === 'running' ? 'step' : undefined}
          className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] gap-x-3 py-3"
        >
          <span className="relative flex justify-center" aria-hidden>
            <StepIcon status={step.status} />
            {index < steps.length - 1 ? (
              <span className="bg-line absolute top-6 -bottom-5 left-1/2 w-px -translate-x-1/2" />
            ) : null}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className={cn('text-body-sm', LABEL_INK[step.status])}>
              {step.label}
              <span className="sr-only">, {STATUS_WORD[step.status]}</span>
            </span>
            {step.detail ? (
              <span
                className={cn(
                  'text-caption',
                  step.status === 'failed' ? 'text-negative' : 'text-ink-muted',
                )}
              >
                {step.detail}
              </span>
            ) : null}
          </span>
          <StepTime time={step.time} />
        </li>
      ))}
    </ol>
  );
}

/** Elapsed time, or an empty slot: the status word already names a step that has none. */
function StepTime({ time }: Readonly<{ time: string | undefined }>) {
  return (
    <span className="text-data text-ink-muted min-w-[6ch] text-right font-mono tabular-nums">
      {time}
    </span>
  );
}
