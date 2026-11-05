import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';

import { AuthCard, AuthShell } from '@/components/ui/auth-shell';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Tag } from '@/components/ui/tag';

/**
 * OnboardingShell — AuthShell for project setup, with a ProgressBar above the
 * step card: the step's name on the left, "Step n of N" on the right. The
 * progress is not clickable and no step list sits beside the card.
 */
export function OnboardingShell({
  steps,
  current,
  mainLabel,
  barEnd,
  children,
}: Readonly<{
  steps: readonly [string, ...string[]];
  /** 0-based. */
  current: number;
  mainLabel: string;
  barEnd?: ReactNode;
  children: ReactNode;
}>) {
  const index = Math.max(0, Math.min(steps.length - 1, current));
  return (
    <AuthShell mainLabel={mainLabel} barEnd={barEnd}>
      <div className="flex flex-col gap-[var(--card-padding)]">
        <section aria-label="Setup progress">
          <ProgressBar
            label={steps[index]}
            value={index + 1}
            max={steps.length}
            valueLabel={`Step ${index + 1} of ${steps.length}`}
          />
        </section>
        {children}
      </div>
    </AuthShell>
  );
}

/**
 * OnboardingStep — one setup step: the title and help, the fields
 * (`space-5` apart), and a footer row under a rule with Back (ghost), a short
 * note and the one ink action. The footer is a fixed grid row whether or not
 * Back or a note is shown, the action keeps a 120px minimum and the note
 * never wraps; on phones the note takes its own row above the buttons. A step
 * with neither action (a step that is working) has no footer.
 */
export function OnboardingStep({
  title,
  titleId,
  help,
  back,
  next,
  note,
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
  note?: ReactNode;
  children: ReactNode;
}>) {
  const footer =
    back || next ? (
      <footer className="border-line desktop:grid-cols-[auto_minmax(0,1fr)_auto] grid min-h-[calc(var(--control-md)+var(--card-padding))] grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-t pt-[var(--card-padding)]">
        {back ?? <span />}
        {/* Below the desktop breakpoint the note takes its own row above the
            buttons; without a note the middle cell holds the desktop row's shape. */}
        {note ? (
          <p className="text-body-sm text-ink-muted desktop:col-auto desktop:row-auto desktop:text-right col-span-full row-start-1 truncate text-left">
            {note}
          </p>
        ) : (
          <span className="desktop:block hidden" />
        )}
        <span className="flex justify-end *:min-w-30">{next}</span>
      </footer>
    ) : null;
  return (
    <AuthCard title={title} titleId={titleId} sub={help} footer={footer}>
      <div className="flex min-w-0 flex-col gap-[var(--card-padding)]">{children}</div>
    </AuthCard>
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
