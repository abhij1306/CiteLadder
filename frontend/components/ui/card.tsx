import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';
import { cardClasses, type CardTone } from './card-variants';

/**
 * Card is reserved for a meaningful semantic object. It owns a white fill, the
 * card radius, fine edge and subtle layered elevation. Structural layout uses
 * metric groups, ledgers, editorial sections,
 * and workspace panes.
 *
 * Optional eyebrow header hook: render <CardEyebrow> above <CardTitle> for the
 * micro-label — e.g.
 *   <CardHeader><CardEyebrow>Visibility score</CardEyebrow><CardTitle>…
 */
export function Card({
  children,
  className,
  tone = 'default',
  ...props
}: Readonly<ComponentPropsWithoutRef<'section'> & { tone?: CardTone }>) {
  return (
    <section {...props} className={cn(cardClasses(tone), className)}>
      {children}
    </section>
  );
}

/**
 * CardHeader — no bottom rule by default (the editorial language separates the
 * header from content with spacing alone). Pass `bordered` for the few
 * surfaces that genuinely need the hairline, e.g. a header sitting directly
 * atop a full-bleed table.
 *
 * `actions` is the header's trailing slot: a badge, a button, a small control
 * group. The title column (eyebrow, title, description — the children) takes
 * the free width on the left and the actions sit on the same row at the right;
 * when the row is too narrow the actions wrap below the title rather than
 * squeezing it.
 */
export function CardHeader({
  children,
  className,
  bordered,
  actions,
  ...props
}: Readonly<
  ComponentPropsWithoutRef<'header'> & {
    bordered?: boolean;
    /** Trailing controls or status on the title row; wraps below when narrow. */
    actions?: ReactNode;
  }
>) {
  const edge = cn('p-[var(--card-padding)] pb-3', bordered && 'border-border-subtle border-b');
  if (!actions) {
    return (
      <header {...props} className={cn('flex flex-col gap-1', edge, className)}>
        {children}
      </header>
    );
  }
  return (
    <header
      {...props}
      className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2', edge, className)}
    >
      <div className="grid min-w-0 flex-1 basis-60 gap-1">{children}</div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
    </header>
  );
}

/**
 * CardEyebrow — optional micro-label for card headers. Pair with CardTitle;
 * never a heading element.
 */
export function CardEyebrow({
  children,
  className,
  ...props
}: Readonly<ComponentPropsWithoutRef<'span'>>) {
  return (
    <span {...props} className={textRole('label', className)}>
      {children}
    </span>
  );
}

export function CardTitle({
  children,
  className,
  ...props
}: Readonly<ComponentPropsWithoutRef<'h3'>>) {
  return (
    // The object rung, the same one the route H1 and a section H2 sit at. It
    // used to be 18/500 — larger and lighter than both, so a card's title
    // outranked the page's and weight said nothing.
    <h3 {...props} className={textRole('sectionTitle', className)}>
      {children}
    </h3>
  );
}

export function CardDescription({
  children,
  className,
  ...props
}: Readonly<ComponentPropsWithoutRef<'p'>>) {
  return (
    <p {...props} className={cn(textRole('body'), className)}>
      {children}
    </p>
  );
}

/**
 * `flush` drops the inset for content that owns its own edges — a table, a
 * scrolling list — so the card's padding is a mode rather than something the
 * call site cancels with `p-0`.
 */
export function CardContent({
  children,
  className,
  flush,
  ...props
}: Readonly<ComponentPropsWithoutRef<'div'> & { children: ReactNode; flush?: boolean }>) {
  return (
    <div
      {...props}
      className={cn(flush ? '' : 'p-[var(--card-padding)] [header+&]:pt-0', className)}
    >
      {children}
    </div>
  );
}
