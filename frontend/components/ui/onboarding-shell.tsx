import { Check, ChevronLeft } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { AuthLogo } from '@/components/ui/auth-shell';
import { Button, type ButtonProps } from '@/components/ui/button';
import { CARD_FACE } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Tag } from '@/components/ui/tag';
import { ThemeSwitch } from '@/components/ui/theme-switch';
import { cn } from '@/lib/utils';

/**
 * The column a step and its action rail share: `max-w-thread` for a step with
 * several fields, `max-w-prose` for a one-field step, centred in the page
 * gutter.
 */
const STEP_COLUMN = {
  wide: 'max-w-thread desktop:px-[var(--card-padding)] mx-auto w-full px-4',
  narrow: 'max-w-prose desktop:px-[var(--card-padding)] mx-auto w-full px-4',
} as const;

type StepWidth = keyof typeof STEP_COLUMN;

/**
 * OnboardingShell — the frame for workspace and project setup, across the
 * whole viewport: a top rail pinned while the page scrolls, with the logo, the
 * setup's steps in the centre (a numbered stepper; "Step n of N" on phones),
 * and a way out, the account menu and the ThemeSwitch at the right. A rule
 * along the rail's foot fills as the steps complete. The page under it belongs
 * to OnboardingStep, which pins its actions in a rail at the viewport's foot.
 */
export function OnboardingShell({
  steps,
  current = 0,
  mainLabel,
  barEnd,
  children,
}: Readonly<{
  /** The setup's steps; leave out for a one-screen setup. */
  steps?: readonly [string, ...string[]];
  /** 0-based. */
  current?: number;
  mainLabel: string;
  /** Before the ThemeSwitch: a way out, the account menu. */
  barEnd?: ReactNode;
  children: ReactNode;
}>) {
  const index = steps ? Math.max(0, Math.min(steps.length - 1, current)) : 0;
  return (
    <div className="bg-paper text-ink flex min-h-dvh flex-col antialiased">
      <header className="border-line bg-paper sticky top-0 z-10 border-b">
        <div className="desktop:grid-cols-[1fr_auto_1fr] desktop:px-[var(--card-padding)] grid h-[var(--nav-height)] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-4">
          {/* Optically flush with the gutter: the link's 4px focus inset hangs out. */}
          <span className="-ms-1 inline-flex justify-self-start">
            <AuthLogo />
          </span>
          {steps ? <SetupStepper steps={steps} current={index} /> : <span />}
          <div className="flex items-center gap-3 justify-self-end">
            {barEnd}
            <ThemeSwitch />
          </div>
        </div>
        {steps ? (
          <div aria-hidden className="absolute inset-x-0 -bottom-px h-0.5">
            <span
              className="bg-ink block h-full transition-[width] duration-[var(--motion-slow)] ease-[var(--ease-standard)] motion-reduce:transition-none"
              style={{ width: `${((index + 1) / steps.length) * 100}%` }}
            />
          </div>
        ) : null}
      </header>
      <main id="main" aria-label={mainLabel} className="flex flex-1 flex-col">
        {children}
      </main>
    </div>
  );
}

/**
 * The setup's steps in the top rail: from `desktop:` each step's 24px mark (a
 * check when done, its number otherwise; the current one ringed in `ink`) and
 * its label, joined by short rules; below it, "Step n of N" and the current
 * step's name. The current step is `aria-current="step"`, and the count is a
 * native progress bar named by the current step.
 */
function SetupStepper({
  steps,
  current,
}: Readonly<{ steps: readonly [string, ...string[]]; current: number }>) {
  const count = `Step ${current + 1} of ${steps.length}`;
  return (
    <section aria-label="Setup progress" className="flex min-w-0 justify-center">
      <progress
        className="sr-only"
        aria-label={steps[current]}
        max={steps.length}
        value={current + 1}
        aria-valuetext={count}
      />
      <p className="text-caption text-ink-secondary desktop:sr-only truncate font-mono">{count}</p>
      <ol className="desktop:flex hidden items-center gap-3">
        {steps.map((step, index) => (
          <li
            key={step}
            aria-current={index === current ? 'step' : undefined}
            className="flex items-center gap-2"
          >
            {index > 0 ? (
              <span
                aria-hidden
                className={cn('me-1 h-px w-10', index <= current ? 'bg-ink' : 'bg-line-strong')}
              />
            ) : null}
            <StepMark index={index} current={current} />
            <span
              className={cn(
                'text-body-sm whitespace-nowrap',
                index > current ? 'text-ink-muted' : 'text-ink',
                index === current && 'font-medium',
              )}
            >
              {step}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

const MARK = 'text-caption grid size-6 shrink-0 place-items-center rounded-full font-mono';

/** A done step's check on `ink`, the current step's ringed number, a later step's muted one. */
function StepMark({ index, current }: Readonly<{ index: number; current: number }>) {
  if (index < current) {
    return (
      <span aria-hidden className={cn(MARK, 'bg-ink text-paper')}>
        <Check className="size-3.5" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        MARK,
        index === current
          ? 'border-ink text-ink border-2 font-medium'
          : 'border-line-strong text-ink-muted border',
      )}
    >
      {index + 1}
    </span>
  );
}

/**
 * OnboardingStep — one setup step in a single centred column: the title and
 * help, then the step's body in one card across the column. Steps lay their
 * body out in StepColumns, so a desktop step reads across the width instead of
 * down a narrow strip. Back (ghost) and the one ink action sit in a rail
 * pinned to the viewport's foot, so the action never moves between steps or
 * scrolls out of reach on a long one. A step with neither action (a step that
 * is working) has no rail.
 */
export function OnboardingStep({
  title,
  titleId,
  help,
  back,
  next,
  width = 'wide',
  children,
}: Readonly<{
  title: ReactNode;
  /** The heading's id, so the flow can move focus to it on a new step. */
  titleId?: string;
  help?: ReactNode;
  /** A StepBack, or a ghost link; leave out on the first step. */
  back?: ReactNode;
  /** The step's primary Button. */
  next?: ReactNode;
  /** `narrow` for a step with a single field. */
  width?: StepWidth;
  children: ReactNode;
}>) {
  const generatedId = useId();
  const headingId = titleId ?? generatedId;
  return (
    <div className="flex flex-1 flex-col">
      <div
        className={cn(
          STEP_COLUMN[width],
          'desktop:pt-10 desktop:pb-12 flex flex-1 flex-col gap-[var(--card-padding)] pt-6 pb-8',
        )}
      >
        <header className="flex flex-col gap-1">
          <h1
            id={headingId}
            tabIndex={-1}
            className="text-display-sm text-ink font-sans font-medium text-balance"
          >
            {title}
          </h1>
          {help ? <p className="text-body text-ink-secondary">{help}</p> : null}
        </header>
        <section
          aria-labelledby={headingId}
          className={cn(
            CARD_FACE,
            'surface-card desktop:p-[var(--page-section-gap)] flex min-w-0 flex-col gap-[var(--card-padding)] p-[var(--card-padding)]',
          )}
        >
          {children}
        </section>
      </div>
      {back || next ? (
        <footer className="border-line bg-paper sticky bottom-0 z-10 border-t">
          <div className={cn(STEP_COLUMN[width], 'flex items-center justify-between gap-3 py-3')}>
            {back ?? <span />}
            <span className="flex justify-end *:min-w-30">{next}</span>
          </div>
        </footer>
      ) : null}
    </div>
  );
}

/**
 * Two columns from `desktop:` (one below it), top-aligned, for a step's
 * fields or for its two groups of answers.
 */
export function StepColumns({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="desktop:grid-cols-2 desktop:gap-x-10 grid min-w-0 items-start gap-[var(--card-padding)]">
      {children}
    </div>
  );
}

/** What a working step has found so far: a label over a wrapping run of tags. */
export function StepFindings({
  title,
  items,
}: Readonly<{ title: string; items: readonly string[] }>) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-label text-ink">{title}</h2>
      <ul className="flex min-w-0 flex-wrap gap-1">
        {items.map((item, index) => (
          <li key={`${index}:${item}`}>
            <Tag>{item}</Tag>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Back: the ghost button with its chevron. */
export function StepBack({
  children = 'Back',
  ...props
}: Readonly<Omit<ButtonProps, 'variant' | 'className' | 'asChild'>>) {
  return (
    <Button {...props} variant="ghost">
      <Icon icon={ChevronLeft} />
      {children}
    </Button>
  );
}
