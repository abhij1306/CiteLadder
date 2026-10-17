import { LoaderCircle } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Spinner — the one in-place loading indicator.
 *
 * Loading is a THIRD state, distinct from a measured value and from an
 * explicit missing one. A surface that renders "Not measured"
 * while a refetch is in flight states something it does not know yet, and the
 * placeholder flashing in and out of a value slot reads as data that appeared
 * and vanished. The spinner is what occupies that slot until the answer
 * arrives.
 *
 * Hand-rolled `LoaderCircle animate-spin` recipes previously gave each caller
 * its own size and accessibility treatment. One owner keeps an
 * in-place loading state visually and semantically consistent.
 */

const SIZES = {
  /** Inside a dense row or a metric slot. */
  sm: 'size-3.5',
  /** A control or a section. */
  md: 'size-4',
  /** A whole region waiting on its first load. */
  lg: 'size-5',
} as const;

export type SpinnerSize = keyof typeof SIZES;

export function Spinner({
  size = 'md',
  label,
  className,
}: Readonly<{
  size?: SpinnerSize;
  /**
   * What is loading, for assistive technology. Omit ONLY when a visible
   * label beside the spinner already says it — an unlabelled spinner in an
   * otherwise empty slot announces nothing at all.
   */
  label?: string;
  className?: string;
}>) {
  return (
    <LoaderCircle
      className={cn(SIZES[size], 'shrink-0 animate-spin', className)}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
