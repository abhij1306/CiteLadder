import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

/** Skeleton — shimmer between --skeleton-base → --skeleton-highlight. */
export function Skeleton({ className, ...props }: Readonly<HTMLAttributes<HTMLDivElement>>) {
  return <div aria-hidden className={cn('skeleton', className)} {...props} />;
}
