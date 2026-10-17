'use client';

import { useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { segmentedItemVariants, segmentedTrackVariants } from '@/components/ui/segmented-variants';
import { cn } from '@/lib/utils';

/** Arrow keys that move the roving focus, and the direction each moves it. */
const ARROW_DELTA: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/**
 * SegmentedControl — a single-select segmented toggle used for
 * `benchmark_mode`. Radiogroup semantics so it is keyboard + screen-reader
 * accessible; selection is fully controlled by the caller (react-hook-form).
 *
 * Keyboard model is the APG radio-group one: the group holds a single tab stop
 * (only the checked radio is tabbable), and the arrow keys move focus AND
 * selection between options, wrapping at both ends. Both arrow axes move
 * between options. The track stays on one row and scrolls at narrow widths;
 * focused options are revealed inside that track.
 *
 * `trailing` is for a control that shares the track but is NOT one of the
 * choices — Performance's "More" button, which opens the range dialog. It has to
 * sit outside the radio group, because a radio does not open a dialog, while
 * still riding the same rail. Without this slot the only way to get that layout
 * was to rebuild the track by hand, and the one place that did lost the radio
 * semantics and the arrow keys along with it.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  id,
  'aria-describedby': describedBy,
  className,
  disabled = false,
  trailing,
}: Readonly<{
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  ariaLabel?: string;
  id?: string;
  'aria-describedby'?: string;
  className?: string;
  disabled?: boolean;
  /** A control on the same track that is not one of the choices. */
  trailing?: ReactNode;
}>) {
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  // With an off-list `value` nothing is checked, and a group where every option
  // is tabIndex={-1} is unreachable by keyboard — fall back to the first option.
  const selectedIndex = options.findIndex((option) => option.value === value);
  const tabStop = selectedIndex === -1 ? 0 : selectedIndex;

  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    buttonsRef.current[next]?.focus();
  };

  return (
    <div className={cn(segmentedTrackVariants(), className)}>
      {/* A nested flex row on the track's own gap, NOT `display: contents`:
          some browsers drop a contents box from the accessibility tree, which
          would cost the group its name and its radio semantics. Matching the
          gap keeps every segment and the trailing control evenly spaced on one
          rail. */}
      <div
        id={id}
        role="radiogroup"
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        className="flex shrink-0 items-center gap-0.5"
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              ref={(node) => {
                buttonsRef.current[index] = node;
              }}
              type="button"
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Button-based radio keeps roving focus and the segmented-control visual contract.
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              // Roving tabindex: Tab enters the group at the current selection and
              // leaves it again, rather than stepping through every option.
              tabIndex={index === tabStop ? 0 : -1}
              onClick={() => onChange(option.value)}
              onFocus={(event) =>
                event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
              }
              onKeyDown={(event) => {
                const delta = ARROW_DELTA[event.key];
                if (delta === undefined) return;
                // Only once we know we are handling the key — otherwise this would
                // swallow page scrolling for arrows we do not act on.
                event.preventDefault();
                move(index, delta);
              }}
              className={segmentedItemVariants({ selected })}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {trailing}
    </div>
  );
}

/**
 * A control that shares a SegmentedControl's track without being one of its
 * choices — Performance's "More", which opens the range dialog.
 *
 * It lives here rather than at the call site for two reasons. The segment
 * geometry is a design-system recipe, and a feature that reaches for a raw
 * <button> to get it is exactly what `check:policy` rejects; and `Pressable`,
 * the only other sanctioned wrapper, is the ROW affordance — it forces
 * `w-full` and `text-left`, which is why the hand-built version of this
 * stretched its segments.
 *
 * It is a button, not a radio: it opens something rather than selecting a
 * value, so it takes `aria-haspopup` from the caller and never `aria-checked`.
 * `selected` is purely the visual state that says the active range is one of
 * the ones hiding behind it.
 */
export function SegmentedAction({
  selected = false,
  className,
  children,
  ...props
}: Readonly<
  ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; children: ReactNode }
>) {
  return (
    <button
      {...props}
      type="button"
      className={cn(segmentedItemVariants({ selected }), 'gap-1', className)}
    >
      {children}
    </button>
  );
}
