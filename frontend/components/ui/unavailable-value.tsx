import type { ComponentPropsWithoutRef } from 'react';

import { Tooltip } from '@/components/ui/tooltip';
import { availabilityLabel, MISSING_MARK, type DataAvailabilityState } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The mark itself. Shared by `UnavailableValue` and `MissingValue` so a missing
 * measurement is the same glyph with the same accessible name on every surface.
 * Private: callers reach it through one of those two, which is what keeps the
 * accessible name attached to it.
 */
function MissingMark({
  className,
  ...props
}: Readonly<Omit<ComponentPropsWithoutRef<'span'>, 'children'>>) {
  return (
    <span {...props} className={cn('value-placeholder', className)}>
      {/* Aria-hidden so the dash is never read as punctuation; the label
          below is what a screen reader receives in its place. */}
      <span aria-hidden>{MISSING_MARK}</span>
      <span className="sr-only">{availabilityLabel('not_measured')}</span>
    </span>
  );
}

/**
 * Compact, explicit presentation for a product value that is not available as
 * a number.
 *
 * `not_measured` is the one state that renders as the mark rather than as
 * words, wherever it appears — see `MISSING_MARK`. Every other state is a
 * workflow answer the reader can act on ("Not run", "Not set", "Failed"), so
 * it keeps its words.
 */
export function UnavailableValue({
  state,
  className,
  ...props
}: Readonly<
  Omit<ComponentPropsWithoutRef<'span'>, 'children'> & {
    state: DataAvailabilityState;
  }
>) {
  if (state === 'not_measured') return <MissingMark className={className} {...props} />;
  return (
    <span {...props} className={cn('value-placeholder', className)}>
      {availabilityLabel(state)}
    </span>
  );
}

/**
 * The same fact as `UnavailableValue`, for a cell in a column of numbers.
 *
 * It exists for the `reason` affordance: a cell whose column cannot explain why
 * one particular value is absent hangs that explanation off the mark. Without a
 * `reason` this is exactly `UnavailableValue`, which now renders the same mark
 * for `not_measured` on every surface — a metric card, a chart label and a row
 * all say it the same way.
 *
 * What it must never become is blank: an empty cell and a measured zero look
 * identical, and those are opposite findings.
 */
export function MissingValue({
  state = 'not_measured',
  reason,
  className,
  ...props
}: Readonly<
  Omit<ComponentPropsWithoutRef<'span'>, 'children'> & {
    state?: DataAvailabilityState;
    /** Why this particular value is absent, when the column cannot say it. */
    reason?: string;
  }
>) {
  const mark =
    state === 'not_measured' ? (
      <MissingMark className={className} {...props} />
    ) : (
      <span {...props} className={cn('value-placeholder', className)}>
        {availabilityLabel(state)}
      </span>
    );
  if (!reason) return mark;
  return (
    <Tooltip content={reason}>
      {/* A real button, not a span with a tabindex: the reason has to be
          reachable by keyboard, and only an interactive element announces
          itself as something to reach. */}
      <button type="button" className="focus-ring rounded-full">
        {mark}
      </button>
    </Tooltip>
  );
}
