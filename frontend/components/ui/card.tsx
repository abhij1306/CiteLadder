import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cn } from '@/lib/utils';

const CARD_FACE = 'bg-surface text-ink rounded-card';

const cardClasses = () => cn('surface-card p-[var(--card-padding)]', CARD_FACE);

export function Card({
  children,
  className,
  ...props
}: Readonly<ComponentPropsWithoutRef<'section'>>) {
  return (
    <section {...props} className={cn(cardClasses(), className)}>
      {children}
    </section>
  );
}

const HEADER_RULE =
  'not-last:-mx-[var(--card-padding)] not-last:mb-[var(--card-padding)] not-last:border-b not-last:border-rule not-last:px-[var(--card-padding)] not-last:pb-[var(--card-padding)]';

export function CardHeader({
  children,
  className,
  actions,
  ...props
}: Readonly<
  ComponentPropsWithoutRef<'header'> & {
    actions?: ReactNode;
  }
>) {
  if (!actions) {
    return (
      <header {...props} className={cn('flex flex-col gap-1', HEADER_RULE, className)}>
        {children}
      </header>
    );
  }
  return (
    <header
      {...props}
      className={cn('flex flex-wrap items-start justify-between gap-2', HEADER_RULE, className)}
    >
      <div className="grid min-w-0 flex-1 basis-60 gap-1">{children}</div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
    </header>
  );
}

export function CardEyebrow({
  children,
  className,
  ...props
}: Readonly<ComponentPropsWithoutRef<'span'>>) {
  return (
    <span {...props} className={cn('type-screen-label', className)}>
      {children}
    </span>
  );
}
