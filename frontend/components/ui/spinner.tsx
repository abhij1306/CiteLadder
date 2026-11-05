import { cn } from '@/lib/utils';

/**
 * Spinner — a 16px arc for short waits inside a control or beside a sentence:
 * a 2.5px arc in `currentColor` (`ink-secondary` by default; a button's text
 * colour inside one) over a `line` track, one turn per 800ms (1.6s under
 * reduced motion). Tables, lists and charts load with `Skeleton` instead, and
 * long waits with `ProgressBar`.
 *
 * Loading is its own state, distinct from a measured value and from an
 * explicit missing one (invariant 7): the spinner holds the slot until the
 * answer arrives.
 */
export function Spinner({
  label,
  showLabel = false,
  className,
}: Readonly<{
  /**
   * What is loading, present tense ("Saving"). Omit ONLY when a visible label
   * beside the spinner already says it.
   */
  label?: string;
  /** Print the label beside the arc. */
  showLabel?: boolean;
  className?: string;
}>) {
  // With a label it is a polite status (the native <output>); without, decoration.
  const Root = label ? 'output' : 'span';
  return (
    <Root
      aria-label={label && !showLabel ? label : undefined}
      aria-hidden={label ? undefined : true}
      className={cn(
        'text-ink-secondary in-data-[button-variant]:text-inherit inline-flex shrink-0 items-center gap-2 align-middle',
        className,
      )}
    >
      {/* Under reduced motion the turn slows to 1.6s; it never stops, since a
          still arc would read as a stuck one. The arc turns inside the
          svg, so the turning never draws outside its 16px box (a turning
          svg's corners overflowed a scrolling region by 3px). */}
      <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden>
        <g className="animate-spinner origin-center [transform-box:view-box]">
          <circle
            cx="8"
            cy="8"
            r="6.25"
            strokeWidth="2.5"
            className="stroke-line in-data-[button-variant]:stroke-current in-data-[button-variant]:opacity-25"
          />
          <path
            d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25"
            strokeWidth="2.5"
            strokeLinecap="round"
            stroke="currentColor"
          />
        </g>
      </svg>
      {label && showLabel ? <span className="text-body-sm text-ink-secondary">{label}</span> : null}
    </Root>
  );
}
