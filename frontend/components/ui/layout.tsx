import type { ComponentPropsWithoutRef, ElementType } from 'react';

import { cn } from '@/lib/utils';

/**
 * Rhythm belongs to the container, never to its children.
 *
 * Ninety-odd `mt-*` utilities used to carry the spacing between stacked
 * elements, in a dozen different values, which meant changing a screen's rhythm
 * meant editing every child that participated in it. A `Stack` (vertical) or
 * an `Inline` (horizontal) owns the gap once, so the rhythm is a token edit
 * and a feature names the role, never a number.
 *
 * The rungs are one ladder for both directions:
 *   `section`   — between top-level sections of a screen (24px)
 *   `workspace` — between peers inside a section (16px)
 *   `compact`   — between elements inside one component (12px)
 *   `item`      — between the parts of one item: an icon and its text, a
 *                 row's badges, the lines of a short list (8px)
 *   `tight`     — a label and the value it belongs to (4px)
 */
const STACK_GAP = {
  section: 'gap-[var(--page-section-gap)]',
  workspace: 'gap-[var(--workspace-gap)]',
  compact: 'gap-[var(--compact-gap)]',
  item: 'gap-2',
  tight: 'gap-1',
} as const;

export type StackGap = keyof typeof STACK_GAP;

export function Stack({
  as,
  gap = 'compact',
  className,
  children,
  ...props
}: Readonly<ComponentPropsWithoutRef<'div'> & { as?: ElementType; gap?: StackGap }>) {
  const Component = as ?? 'div';
  return (
    <Component {...props} className={cn('grid', STACK_GAP[gap], className)}>
      {children}
    </Component>
  );
}

/**
 * The horizontal rungs: the `Stack` ladder, plus `meta` — a wrapping line of
 * facts (a footer's timestamps, a row's counts), 16 between facts and 4
 * between wrapped lines.
 */
const INLINE_GAP = {
  workspace: 'gap-[var(--workspace-gap)]',
  compact: 'gap-[var(--compact-gap)]',
  item: 'gap-2',
  tight: 'gap-1',
  meta: 'flex-wrap gap-x-4 gap-y-1',
} as const;

export type InlineGap = keyof typeof INLINE_GAP;

/**
 * A row of items, centred on one line. The caller may add alignment and
 * wrapping (`justify-between`, `items-start`, `flex-wrap`), never spacing.
 */
export function Inline({
  as,
  gap = 'item',
  className,
  children,
  ...props
}: Readonly<ComponentPropsWithoutRef<'div'> & { as?: ElementType; gap?: InlineGap }>) {
  const Component = as ?? 'div';
  return (
    <Component {...props} className={cn('flex min-w-0 items-center', INLINE_GAP[gap], className)}>
      {children}
    </Component>
  );
}
