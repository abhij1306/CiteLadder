import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useId, type ReactNode } from 'react';
import '@/apps/app/src/website-type.css';

import { cn } from '@/lib/utils';

import { Inline } from '@/components/ui/layout';
import { LogoMark } from '@/components/ui/logo-mark';

export type FlowStep = {
  id: string;
  label: string;
};

export function FlowShell({
  children,
  steps,
  currentStep = 0,
  actions,
  footer,
  exitHref,
  trailing,
  mainLabel,
  align = 'start',
  measure = 'default',
}: Readonly<{
  children: ReactNode;
  steps?: readonly FlowStep[];
  currentStep?: number;
  actions?: ReactNode;
  footer?: ReactNode;
  exitHref?: string;
  /**
   * The flow bar's right-hand slot, when the caller owns something better than
   * an exit link — the account menu, say. `FlowShell` never mounts that itself,
   * so the shell renders without a session tree above it.
   */
  trailing?: ReactNode;
  mainLabel: string;
  align?: 'start' | 'center';
  measure?: 'default' | 'wide';
}>) {
  return (
    <div
      data-flow-surface
      className="bg-background text-foreground relative grid h-dvh min-h-dvh grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden antialiased"
    >
      <FlowBar steps={steps} currentStep={currentStep} exitHref={exitHref} trailing={trailing} />
      <main
        id="main"
        aria-label={mainLabel}
        className="flow-main"
        data-flow-align={align}
        data-flow-measure={measure}
      >
        <div className="flow-content app-pane" data-flow-measure={measure}>
          {children}
        </div>
      </main>
      {actions ?? (footer ? <footer className="flow-footer">{footer}</footer> : null)}
    </div>
  );
}

function FlowBar({
  steps,
  currentStep,
  exitHref,
  trailing,
}: Readonly<{
  steps?: readonly FlowStep[];
  currentStep: number;
  exitHref?: string;
  trailing?: ReactNode;
}>) {
  // The bar is a three-column grid, so this cell is always exactly one child —
  // an empty span when there is nothing to put in it, and one row when there
  // is both a way out and an account. `.flow-exit` carries its own
  // `justify-self`, which the row takes over once it is not the cell itself.
  const exitLink = exitHref ? (
    <Link to={exitHref} className="flow-exit">
      Exit
    </Link>
  ) : null;
  const exit: ReactNode =
    exitLink || trailing ? (
      <Inline gap="compact" className="justify-end justify-self-end">
        {exitLink}
        {trailing}
      </Inline>
    ) : (
      <span />
    );
  return (
    <header className="flow-bar">
      <div className="flow-bar-content">
        <Link
          to="/projects"
          aria-label="CiteLadder projects"
          className="group inline-flex items-center no-underline transition-opacity hover:opacity-90"
        >
          <LogoMark />
        </Link>
        {steps ? <FlowProgress steps={steps} currentStep={currentStep} /> : <span />}
        {exit}
      </div>
      {steps ? (
        <div className="flow-progress-rule" aria-hidden="true">
          <span style={{ transform: `scaleX(${(currentStep + 1) / steps.length})` }} />
        </div>
      ) : null}
    </header>
  );
}

function FlowProgress({
  steps,
  currentStep,
}: Readonly<{ steps: readonly FlowStep[]; currentStep: number }>) {
  return (
    <nav aria-label="Setup progress" className="flow-progress">
      <ol>
        {steps.map((step, index) => {
          const isCurrent = index === currentStep;
          const isDone = index < currentStep;
          return (
            <li key={step.id} aria-current={isCurrent ? 'step' : undefined}>
              {index > 0 ? <span className="flow-step-connector" aria-hidden="true" /> : null}
              <span
                className={cn(
                  'flow-step-mark',
                  isCurrent && 'flow-step-mark-current',
                  isDone && 'flow-step-mark-done',
                )}
                aria-hidden="true"
              >
                {isDone ? <Check /> : index + 1}
              </span>
              <span className="flow-step-label">
                <span className="flow-step-mobile-prefix">
                  Step {index + 1} of {steps.length} ·{' '}
                </span>
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function FlowActions({
  secondary,
  primary,
  wide = false,
}: Readonly<{ secondary?: ReactNode; primary: ReactNode; wide?: boolean }>) {
  return (
    <footer className="flow-actions safe-bottom">
      <div className="flow-action-content" data-flow-measure={wide ? 'wide' : 'default'}>
        <div>{secondary}</div>
        <div>{primary}</div>
      </div>
    </footer>
  );
}

export function FlowGroup({
  title,
  help,
  meta,
  action,
  className,
  children,
}: Readonly<{
  title: string;
  help?: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}>) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className={cn('flow-group', className)}>
      <div className="flow-group-heading">
        <div className="flow-group-copy">
          <h2 id={headingId} className="flow-group-title">
            {title}
          </h2>
          {help ? <p className="flow-help">{help}</p> : null}
        </div>
        {meta || action ? (
          <div className="flow-group-aside">
            {meta ? <span className="flow-meta">{meta}</span> : null}
            {action}
          </div>
        ) : null}
      </div>
      <div className="flow-answer">{children}</div>
    </section>
  );
}
