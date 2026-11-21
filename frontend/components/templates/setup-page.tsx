import { useId, type ComponentProps, type ReactNode } from 'react';

import { useDocumentTitle } from '@/components/layout/use-route-announcement';
import { FlowLogo } from '@/components/templates/flow-page';
import { FLOW_CARD } from '@/components/templates/notice-page';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { RungTrail } from '@/components/ui/rung-trail';
import { Tag } from '@/components/ui/tag';
import { ThemeSwitch } from '@/components/ui/theme-switch';
import { textRole } from '@/components/ui/typography';
import { Check, ChevronLeft } from '@/lib/icons';
import { cn } from '@/lib/utils';

const STEP_COLUMN = {
  wide: 'max-w-thread mx-auto w-full px-[var(--content-gutter)]',
  narrow: 'max-w-prose mx-auto w-full px-[var(--content-gutter)]',
} as const;

type StepWidth = keyof typeof STEP_COLUMN;

export function SetupPage({
  label,
  steps,
  current = 0,
  barEnd,
  children,
}: Readonly<{
  label: string;
  steps?: readonly [string, ...string[]];
  current?: number;
  barEnd?: ReactNode;
  children: ReactNode;
}>) {
  const index = steps ? Math.max(0, Math.min(steps.length - 1, current)) : 0;
  return (
    <div className="bg-ground text-ink flex min-h-dvh flex-col antialiased">
      <header className="border-rule bg-ground sticky top-0 z-10 border-b">
        <div className="grid min-h-[var(--masthead-height)] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-[var(--content-gutter)]">
          <span className="inline-flex">
            <FlowLogo />
          </span>
          {steps ? <SetupStepper steps={steps} current={index} /> : <span />}
          <div className="flex items-center justify-end gap-2">
            {barEnd}
            <ThemeSwitch />
          </div>
        </div>
        {steps ? (
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-0.5">
            <span
              className="bg-primary block h-full"
              style={{ width: `${((index + 1) / steps.length) * 100}%` }}
            />
          </div>
        ) : null}
      </header>
      <main
        id="main"
        aria-label={label}
        className="flex flex-1 flex-col [--control-md:var(--control-lg)]"
      >
        {children}
      </main>
    </div>
  );
}

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
      <p aria-hidden className={textRole('caption', 'desktop:hidden truncate')}>
        {count}
      </p>
      <p className="sr-only">{count}</p>
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
                className={cn('h-px w-10', index <= current ? 'bg-primary' : 'bg-rule')}
              />
            ) : null}
            <StepMark index={index} current={current} />
            <span
              className={textRole(
                index === current ? 'label' : 'body',
                cn('whitespace-nowrap', index > current ? 'text-ink-2' : 'text-ink'),
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

const MARK = 'grid size-6 shrink-0 place-items-center rounded-full';

function StepMark({ index, current }: Readonly<{ index: number; current: number }>) {
  if (index < current) {
    return (
      <span aria-hidden className={cn(MARK, 'bg-primary text-on-primary')}>
        <Check className="size-3.5" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={textRole(
        'caption',
        cn(
          MARK,
          'border',
          index === current ? 'border-control-line text-ink' : 'border-rule text-ink-2',
        ),
      )}
    >
      {index + 1}
    </span>
  );
}

export function SetupStep({
  title,
  titleId,
  help,
  back,
  next,
  width = 'wide',
  children,
}: Readonly<{
  title: ReactNode;
  titleId?: string;
  help?: ReactNode;
  back?: ReactNode;
  next?: ReactNode;
  width?: StepWidth;
  children: ReactNode;
}>) {
  const generatedId = useId();
  const headingId = titleId ?? generatedId;
  useDocumentTitle(typeof title === 'string' ? title : undefined);
  return (
    <div className="flex flex-1 flex-col">
      <div className={cn(STEP_COLUMN[width], 'flex flex-1 flex-col gap-4 py-6')}>
        <header className="flex flex-col gap-2">
          <h1 id={headingId} tabIndex={-1} className={textRole('title', 'text-balance')}>
            {title}
          </h1>
          {help ? <p className={textRole('body', 'text-ink-2')}>{help}</p> : null}
        </header>
        <section
          aria-labelledby={headingId}
          className={cn(FLOW_CARD, 'flex min-w-0 flex-col gap-[var(--card-padding)]')}
        >
          {children}
        </section>
      </div>
      {back || next ? (
        <footer className="border-rule bg-ground sticky bottom-0 z-10 border-t">
          <div className={cn(STEP_COLUMN[width], 'flex items-center justify-between gap-3 py-3')}>
            {back ?? <span />}
            <span className="flex justify-end">{next}</span>
          </div>
        </footer>
      ) : null}
    </div>
  );
}

export function StepColumns({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="desktop:grid-cols-2 grid min-w-0 items-start gap-[var(--card-padding)]">
      {children}
    </div>
  );
}

export function StepTrail(props: Readonly<Omit<ComponentProps<typeof RungTrail>, 'size'>>) {
  return <RungTrail {...props} size="lg" />;
}

export function StepFindings({
  title,
  items,
}: Readonly<{ title: string; items: readonly string[] }>) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className={textRole('subheading')}>{title}</h2>
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

export function StepBack({
  children = 'Back',
  ...props
}: Readonly<Omit<ButtonProps, 'variant' | 'className' | 'asChild'>>) {
  return (
    <Button {...props} variant="quiet">
      <Icon icon={ChevronLeft} />
      {children}
    </Button>
  );
}
