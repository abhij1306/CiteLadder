import { useEffect, useRef, type ReactNode } from 'react';

import { Pressable } from '@/components/ui/pressable';
import { sidebarNavRowClasses } from '@/components/ui/sidebar';
import { textRole } from '@/components/ui/typography';
import { Check } from '@/lib/icons';
import { cn } from '@/lib/utils';

export type StepItem<T extends string> = Readonly<{ value: T; label: string }>;

export function StepsLayout<T extends string>({
  label,
  steps,
  current,
  onStep,
  note,
  footerStart,
  footerEnd,
  children,
}: Readonly<{
  label: string;
  steps: readonly StepItem<T>[];
  current: T;
  onStep: (step: T) => void;
  note?: ReactNode;
  footerStart: ReactNode;
  footerEnd: ReactNode;
  children: ReactNode;
}>) {
  const index = steps.findIndex((step) => step.value === current);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (active === document.body || active?.id === 'main')
      scroller.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="flex h-[calc(100dvh-var(--route-chrome-height))] min-h-0 min-w-0 flex-col">
      <div
        ref={scroller}
        tabIndex={-1}
        data-page-scroller=""
        className="desktop:flex-row relative flex min-h-0 min-w-0 flex-1 flex-col gap-[var(--page-top-gap)] overflow-y-auto outline-none"
      >
        <nav
          aria-label={label}
          className="desktop:sticky desktop:top-0 desktop:self-start flex w-56 shrink-0 flex-col"
        >
          <ol className="flex min-w-0 flex-col gap-1">
            {steps.map((step, position) => (
              <li key={step.value}>
                <StepRow
                  step={step}
                  position={position}
                  current={index}
                  onStep={() => onStep(step.value)}
                />
              </li>
            ))}
          </ol>
          {note ? <p className={textRole('caption', 'text-ink-2 px-2 pt-3')}>{note}</p> : null}
        </nav>
        <section aria-label={steps[index]?.label} className="min-w-0 flex-1">
          {children}
        </section>
      </div>
      <div
        data-page-band="action-bar"
        className="bg-raised border-rule rounded-card shadow-pop mt-[var(--workspace-gap)] flex min-h-[var(--filter-bar-height)] min-w-0 shrink-0 flex-wrap items-center gap-2 border px-[var(--card-padding)] py-2"
      >
        {footerStart}
        <span className="flex-1" />
        {footerEnd}
      </div>
    </div>
  );
}

function StepRow<T extends string>({
  step,
  position,
  current,
  onStep,
}: Readonly<{ step: StepItem<T>; position: number; current: number; onStep: () => void }>) {
  const done = position < current;
  const face = (
    <>
      <span
        aria-hidden
        className={textRole(
          'caption',
          cn(
            'grid size-4 shrink-0 place-items-center rounded-full tabular-nums',
            done && 'text-ink-2',
            position === current && 'border-ink text-ink border',
            position > current && 'border-control-line text-ink-2 border',
          ),
        )}
      >
        {done ? <Check className="size-3.5" /> : position + 1}
      </span>
      <span className={cn('truncate', position > current && 'text-ink-2')}>{step.label}</span>
    </>
  );
  if (done) {
    return (
      <Pressable className={sidebarNavRowClasses(false)} onClick={onStep}>
        {face}
        <span className="sr-only">(completed)</span>
      </Pressable>
    );
  }
  return (
    <span
      aria-current={position === current ? 'step' : undefined}
      className={sidebarNavRowClasses(position === current, 'pointer-events-none')}
    >
      {face}
    </span>
  );
}
