import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

/**
 * The placeholder shapes, by what they stand in for — never a size a feature
 * picks:
 *   `line`  — one line of text or a value (16 tall, the row's width)
 *   `block` — a short block of content: a card's body, a quoted passage (96)
 *   `chart` — a chart's plot area (the default chart height)
 */
const SKELETON_SHAPE = {
  line: 'h-4 w-full',
  block: 'h-24 w-full',
  chart: 'h-[var(--chart-height-md)] w-full',
} as const;

export type SkeletonShape = keyof typeof SKELETON_SHAPE;

/** Skeleton — shimmer between --skeleton-base → --skeleton-highlight. */
export function Skeleton({
  shape,
  className,
  ...props
}: Readonly<HTMLAttributes<HTMLDivElement> & { shape?: SkeletonShape }>) {
  return (
    <div
      aria-hidden
      className={cn('skeleton', shape && SKELETON_SHAPE[shape], className)}
      {...props}
    />
  );
}
