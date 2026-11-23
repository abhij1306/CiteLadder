import type { ReactNode } from 'react';

import { Icon } from '@/components/ui/icon';
import { SLIP_FACE } from '@/components/ui/slip';
import { Spinner } from '@/components/ui/spinner';
import { textRole } from '@/components/ui/typography';
import { Check, ChevronRight, CircleHelp, X } from '@/lib/icons';
import { cn } from '@/lib/utils';

export type RungStatus = 'pending' | 'running' | 'done' | 'failed' | 'unavailable' | 'unknown';

export type TrailStep = Readonly<{
  id?: string;
  label: string;
  status: RungStatus;
  detail?: string | null;
  time?: string;
}>;

const STATUS_WORD = {
  pending: 'Waiting',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  unavailable: 'Unavailable',
  unknown: 'Unknown',
} as const satisfies Record<RungStatus, string>;

function rungFace(status: RungStatus) {
  switch (status) {
    case 'pending':
      return 'bg-rule';
    case 'running':
      return 'bg-ink animate-live-rung';
    case 'done':
      return 'bg-ink';
    case 'failed':
      return 'bg-negative';
    case 'unavailable':
      return 'bg-well';
    case 'unknown':
      return 'border border-control-line';
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

function StepGlyph({ status }: Readonly<{ status: RungStatus }>) {
  if (status === 'done') return <Icon icon={Check} className="text-ink-2 my-0" />;
  if (status === 'failed') return <Icon icon={X} className="text-negative my-0" />;
  if (status === 'unknown') return <Icon icon={CircleHelp} className="text-ink-2 my-0" />;
  return null;
}

export function RungTrail({
  steps,
  label,
  orientation = 'vertical',
  size = 'md',
  className,
}: Readonly<{
  steps: readonly TrailStep[];
  label: string;
  orientation?: 'vertical' | 'horizontal';
  size?: RowSize;
  className?: string;
}>) {
  if (orientation === 'horizontal') {
    return (
      <ol
        aria-label={label}
        data-rung-trail="horizontal"
        className={cn('m-0 flex min-w-0 list-none flex-wrap p-0', className)}
      >
        {steps.map((step) => (
          <li
            key={step.id ?? step.label}
            aria-current={step.status === 'running' ? 'step' : undefined}
            className="relative flex min-w-0 flex-col gap-2 pe-6"
          >
            <span aria-hidden className="flex h-4 items-center">
              <span className="bg-rule absolute inset-x-0 top-2 h-px" />
              <span
                className={cn('rounded-mark relative block h-4 w-1.5', rungFace(step.status))}
              />
            </span>
            <span
              className={textRole(
                step.status === 'running' ? 'label' : 'body',
                step.status === 'pending' ? 'text-ink-2' : undefined,
              )}
            >
              {step.label}
              <span className="sr-only">, {STATUS_WORD[step.status]}</span>
            </span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ol
      aria-label={label}
      data-rung-trail="vertical"
      className={cn('m-0 flex min-w-0 list-none flex-col p-0', className)}
    >
      {steps.map((step, index) => (
        <RungRow
          key={step.id ?? step.label}
          step={step}
          first={index === 0}
          last={index === steps.length - 1}
          size={size}
        />
      ))}
    </ol>
  );
}

type RowSize = 'md' | 'lg';

const ROW_SIZE = {
  md: {
    row: 'pb-2',
    rail: 'h-5',
    line: 'h-5',
    railTop: 'top-2.5',
    bridge: '-bottom-2 h-auto',
    gap: '',
    label: (running: boolean) => textRole(running ? 'label' : 'body'),
  },
  lg: {
    row: '',
    rail: '',
    line: 'h-6',
    railTop: 'top-3',
    bridge: 'bottom-0',
    gap: 'pb-3',
    label: (running: boolean) => textRole('prose', cn('leading-6', running && 'type-emphasis')),
  },
} as const satisfies Record<RowSize, unknown>;

function RungRow({
  step,
  first,
  last,
  size,
}: Readonly<{ step: TrailStep; first: boolean; last: boolean; size: RowSize }>) {
  const geometry = ROW_SIZE[size];
  return (
    <li
      aria-current={step.status === 'running' ? 'step' : undefined}
      data-rung-status={step.status}
      className={cn(
        'grid grid-cols-[0.75rem_1rem_minmax(0,1fr)_auto] gap-x-2 last:pb-0',
        geometry.row,
      )}
    >
      <span aria-hidden className={cn('relative flex justify-center', geometry.rail)}>
        <span
          className={cn(
            'bg-rule absolute left-1/2 w-px -translate-x-1/2',
            first ? geometry.railTop : 'top-0',
            last ? 'h-0' : geometry.bridge,
          )}
        />
        <span className={cn('relative flex items-center', geometry.line)}>
          <span className={cn('rounded-mark block h-1 w-3', rungFace(step.status))} />
        </span>
      </span>
      <span aria-hidden className={cn('flex items-center', geometry.line)}>
        {step.status === 'running' ? <Spinner /> : <StepGlyph status={step.status} />}
      </span>
      <span className={cn('flex min-w-0 flex-col', !last && geometry.gap)}>
        <span
          className={cn(
            geometry.label(step.status === 'running'),
            step.status === 'pending' && 'text-ink-2',
          )}
        >
          {step.label}
          <span className="sr-only">, {STATUS_WORD[step.status]}</span>
        </span>
        {step.detail ? (
          <span
            className={textRole(
              'caption',
              cn('break-words', step.status === 'failed' && 'text-negative'),
            )}
          >
            {step.detail}
          </span>
        ) : null}
        {!step.detail && step.status === 'unavailable' ? (
          <span aria-hidden className={textRole('caption')}>
            {STATUS_WORD.unavailable}
          </span>
        ) : null}
      </span>
      <span className="type-caption min-w-[6ch] text-right tabular-nums">{step.time}</span>
    </li>
  );
}

export type SetupStep = Readonly<{
  id: string;
  label: string;
  state: 'done' | 'next' | 'running' | 'waiting';
  action?: ReactNode;
}>;

const SETUP_WORD = {
  done: 'Done',
  next: 'Next',
  running: 'Running',
  waiting: 'Waiting',
} as const satisfies Record<SetupStep['state'], string>;

export function SetupSteps({
  steps,
  label,
}: Readonly<{ steps: readonly SetupStep[]; label: string }>) {
  return (
    <ol
      aria-label={label}
      className={cn(SLIP_FACE, 'divide-rule m-0 list-none divide-y overflow-hidden p-0')}
    >
      {steps.map((step) => {
        const current = step.state === 'next' || step.state === 'running';
        return (
          <li
            key={step.id}
            aria-current={current ? 'step' : undefined}
            data-setup-step={step.state}
            className="relative flex min-h-10 min-w-0 items-center gap-2 px-4"
          >
            {current ? (
              <span
                aria-hidden
                className="bg-accent absolute inset-y-2 start-0 w-0.5 rounded-full"
              />
            ) : null}
            <span aria-hidden className="flex w-4 shrink-0 justify-center">
              {step.state === 'done' ? <Icon icon={Check} className="text-ink-2 my-0" /> : null}
              {step.state === 'running' ? <Spinner /> : null}
            </span>
            <span
              className={textRole(
                current ? 'label' : 'body',
                cn('min-w-0 truncate', step.state === 'waiting' ? 'text-ink-2' : 'text-ink'),
              )}
            >
              {step.label}
            </span>
            <span className={textRole('caption', 'text-ink-2 shrink-0')}>
              <span className="sr-only">, </span>
              {SETUP_WORD[step.state]}
            </span>
            {current && step.action ? (
              <span className="ms-auto shrink-0">{step.action}</span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function FoldedTrail({
  summary,
  live,
  label,
  steps,
  empty,
}: Readonly<{
  summary?: ReactNode;
  live?: Readonly<{ status: string; seconds: number }>;
  label: string;
  steps: readonly TrailStep[];
  empty?: string;
}>) {
  return (
    <>
      <details className="group grid min-w-0">
        <summary
          className={textRole(
            'caption',
            'focus-ring flex min-h-6 min-w-0 cursor-pointer list-none items-center gap-2 rounded-control whitespace-nowrap [&::-webkit-details-marker]:hidden',
          )}
        >
          {live ? <Spinner /> : null}
          <span className="min-w-0 truncate">{live ? live.status : summary}</span>
          {live ? (
            <span className="type-caption shrink-0 text-current tabular-nums">{live.seconds}s</span>
          ) : null}
          <Icon icon={ChevronRight} className="text-ink-2 my-0 shrink-0 group-open:rotate-90" />
        </summary>
        <div className="pt-3">
          {steps.length ? (
            <RungTrail steps={steps} label={label} />
          ) : (
            <p className={textRole('caption')}>{empty}</p>
          )}
        </div>
      </details>
      {live ? (
        <output aria-live="polite" className="sr-only">
          {live.status}
        </output>
      ) : null}
    </>
  );
}
