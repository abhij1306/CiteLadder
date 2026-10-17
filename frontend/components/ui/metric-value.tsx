import { Spinner } from '@/components/ui/spinner';
import { MISSING_MARK } from '@/lib/format';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

/**
 * MetricValue — one numeral slot, with its three states owned in one place.
 *
 * A value slot is always exactly one of:
 *
 *   - **loading** — a spinner. Not a placeholder: a refetch in flight does not
 *     mean the value is missing, and rendering "Not measured" for the second
 *     it takes states something the surface does not know yet.
 *   - **missing** — the shared missing mark at the numeral's role in muted ink.
 *     `label` becomes its accessible name, so the state is still announced
 *     without a phrase set at numeral size.
 *   - **measured** — the value, at the caller's numeral role.
 *
 * Every state occupies the SAME box. The slot reserves the numeral's line
 * height, so a card does not resize when its value arrives, disappears, or
 * starts reloading — the row beneath it must not move under the reader's
 * pointer.
 */

/** Line box per numeral role, so the slot is the same height in every state. */
const SLOT_HEIGHT = {
  figure: 'min-h-8',
  figureSm: 'min-h-6',
} as const;

export type MetricValueSize = keyof typeof SLOT_HEIGHT;

export function MetricValue({
  value,
  label,
  size = 'figure',
  loading = false,
  tone,
  className,
}: Readonly<{
  /** The formatted value, or null when the window measured nothing for it. */
  value: string | null;
  /** The missing state's accessible name, e.g. "Not measured". */
  label: string;
  size?: MetricValueSize;
  loading?: boolean;
  /** Ink override — an on-accent card passes its own foreground. */
  tone?: string;
  className?: string;
}>) {
  const slot = cn('flex items-center', SLOT_HEIGHT[size], className);
  if (loading) {
    return (
      <div className={slot}>
        <Spinner size={size === 'figure' ? 'md' : 'sm'} label="Loading" className={tone} />
      </div>
    );
  }
  if (value === null) {
    // The mark takes the numeral's own role in muted ink, so an absent figure
    // sits in the same place and size as a present one and never out-ranks it.
    return (
      <div className={slot}>
        <span className={textRole(size, cn('text-muted', tone))}>
          <span aria-hidden>{MISSING_MARK}</span>
          <span className="sr-only">{label}</span>
        </span>
      </div>
    );
  }
  return (
    <div className={slot}>
      <span className={textRole(size, tone)}>{value}</span>
    </div>
  );
}
