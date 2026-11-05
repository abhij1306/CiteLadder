import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Card — a `surface` box on the page that groups one thing: a chart, a
 * table, a form. `radius-lg`, `shadow-card` and a 24px inset on the box
 * itself, so content that owns its edges (a table, a scrolling list) sits in
 * the same inset as text.
 *
 *   `plain` (default) — the white card.
 *   `muted` — a flat `surface-sunken` well for secondary content: a tip, a
 *             code sample, an empty state.
 *   `ink`   — the one inverted tile a page may hold, for one emphasised
 *             quote or number.
 *
 * Cards never nest and never take a coloured edge or fill. The card sets no
 * display of its own: a flex column would re-flow every card and put an
 * overflow boundary between a sticky child and its scroll container.
 */
export type CardTone = 'plain' | 'muted' | 'ink';

const CARD_TONE = {
  plain: 'bg-surface text-ink shadow-card',
  muted: 'bg-surface-sunken text-ink',
  ink: 'bg-ink text-on-ink',
} as const satisfies Record<CardTone, string>;

/** The card face, for a semantic element that is not a `section` (a list item, a link). */
export const cardClasses = (tone: CardTone = 'plain') =>
  cn('surface-card rounded-lg p-[var(--card-padding)]', CARD_TONE[tone]);

export function Card({
  children,
  className,
  tone = 'plain',
  ...props
}: Readonly<ComponentPropsWithoutRef<'section'> & { tone?: CardTone }>) {
  return (
    <section {...props} className={cn(cardClasses(tone), className)}>
      {children}
    </section>
  );
}

/**
 * CardHeader — the eyebrow, title and description on the left and `actions`
 * (a secondary or ghost Button, a Badge, a small control group) on the same
 * row at the right; when the row is too narrow the actions wrap below the
 * title rather than squeezing it. 16 below it when the card has more content.
 */
export function CardHeader({
  children,
  className,
  actions,
  ...props
}: Readonly<
  ComponentPropsWithoutRef<'header'> & {
    /** Trailing controls or status on the title row; wraps below when narrow. */
    actions?: ReactNode;
  }
>) {
  if (!actions) {
    return (
      <header {...props} className={cn('flex flex-col gap-1 not-last:pb-4', className)}>
        {children}
      </header>
    );
  }
  return (
    <header
      {...props}
      className={cn(
        'flex flex-wrap items-start justify-between gap-x-4 gap-y-2 not-last:pb-4',
        className,
      )}
    >
      <div className="grid min-w-0 flex-1 basis-60 gap-1">{children}</div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
    </header>
  );
}

/** CardEyebrow — the mono uppercase label above a CardTitle; never a heading. */
export function CardEyebrow({
  children,
  className,
  ...props
}: Readonly<ComponentPropsWithoutRef<'span'>>) {
  return (
    <span {...props} className={cn('type-eyebrow', className)}>
      {children}
    </span>
  );
}

/** CardTitle — 16/24 Geist 500 in `ink`. */
export function CardTitle({
  children,
  className,
  ...props
}: Readonly<ComponentPropsWithoutRef<'h3'>>) {
  return (
    <h3
      {...props}
      className={cn('text-label-lg text-ink font-medium tracking-[-0.01em]', className)}
    >
      {children}
    </h3>
  );
}

/** CardDescription — one or two sentences under the title, in `ink-secondary`. */
export function CardDescription({
  children,
  className,
  ...props
}: Readonly<ComponentPropsWithoutRef<'p'>>) {
  return (
    <p {...props} className={cn('text-body-sm text-ink-secondary', className)}>
      {children}
    </p>
  );
}

/** The card's body: no padding of its own, since the card carries the inset. */
export function CardContent({
  children,
  className,
  ...props
}: Readonly<ComponentPropsWithoutRef<'div'> & { children: ReactNode }>) {
  return (
    <div {...props} className={className}>
      {children}
    </div>
  );
}
