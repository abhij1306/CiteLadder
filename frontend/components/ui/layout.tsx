import type { ComponentPropsWithoutRef, ComponentPropsWithRef, ElementType } from 'react';

import { cn } from '@/lib/utils';

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
}: Readonly<ComponentPropsWithRef<'div'> & { as?: ElementType; gap?: StackGap }>) {
  const Component = as ?? 'div';
  return (
    <Component {...props} data-rhythm-gap={gap} className={cn('grid', STACK_GAP[gap], className)}>
      {children}
    </Component>
  );
}

const INLINE_GAP = {
  workspace: 'gap-[var(--workspace-gap)]',
  compact: 'gap-[var(--compact-gap)]',
  item: 'gap-2',
  tight: 'gap-1',
  meta: 'flex-wrap gap-x-4 gap-y-1',
  status: 'flex-wrap gap-x-2 gap-y-1',
} as const;

export type InlineGap = keyof typeof INLINE_GAP;

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
