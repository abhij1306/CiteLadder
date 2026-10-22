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
 * One form: the 16px glyph, the same size as every icon beside a control's
 * text. It used to come in three sizes (14, 16, 20) chosen per call site, so
 * the same "loading" read at a different weight on every screen.
 */
export function Spinner({
  label,
  className,
}: Readonly<{
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
      className={cn('size-4 shrink-0 animate-spin', className)}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
