import type { ComponentPropsWithoutRef, ElementType } from 'react';

import { cn } from '@/lib/utils';

/**
 * Vertical rhythm belongs to the container, never to its children.
 *
 * Ninety-odd `mt-*` utilities used to carry the spacing between stacked
 * elements, in a dozen different values, which meant changing a screen's rhythm
 * meant editing every child that participated in it. A `Stack` owns the gap
 * once, so the rhythm is a token edit.
 *
 * The three rungs are the section ladder:
 *   `section`   — between top-level sections of a screen (24px)
 *   `workspace` — between peers inside a section (16px)
 *   `compact`   — between elements inside one component (12px)
 *   `tight`     — a label and the value it belongs to (4px)
 */
const STACK_GAP = {
  section: 'gap-[var(--page-section-gap)]',
  workspace: 'gap-[var(--workspace-gap)]',
  compact: 'gap-[var(--compact-gap)]',
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
