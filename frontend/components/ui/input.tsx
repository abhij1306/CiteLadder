import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';

import { cn } from '@/lib/utils';

/** Fields share a hairline boundary whose colour shows keyboard focus. */
const inputClasses =
  'focus-input h-[var(--control-height-md)] w-full rounded-[var(--radius-control)] border border-border bg-input px-3 text-field text-foreground leading-[calc(var(--control-height-md)_-_2px)] transition-[border-color,background-color] placeholder:text-muted enabled:hover:border-border-strong aria-invalid:border-danger aria-invalid:enabled:hover:border-danger disabled:cursor-not-allowed disabled:bg-disabled disabled:text-muted disabled:border-border-subtle';

/** Preserve the composer emphasis through a stronger boundary. */
const raisedClasses = 'border border-border-strong enabled:hover:border-border-strong';

/**
 * The roomier field used on the standalone auth and onboarding screens, where a
 * form is the whole page rather than one control in a dense table.
 *
 * Large fields use the large control role. The product field is the 32px
 * `md` everywhere; `lg` is the flow's rung only.
 */
const inputSizes = {
  md: '',
  lg: 'h-[var(--control-height-lg)] px-3 leading-[calc(var(--control-height-lg)_-_2px)]',
} as const;

/**
 * A field fills its column (`fill`) unless its role is narrower: `quantity`
 * is a small count beside the control that acts on it (4rem, centred,
 * tabular figures), so every quantity picker reads at one width.
 */
const inputWidths = {
  fill: '',
  quantity: 'w-16 text-center tabular-nums',
} as const;

const adornedLineHeights = {
  md: 'leading-[calc(var(--control-height-md)_-_2px)]',
  lg: 'leading-[calc(var(--control-height-lg)_-_2px)]',
} as const;

export function Input({
  className,
  containerClassName,
  startContent,
  endContent,
  endContentFlush = false,
  size = 'md',
  width = 'fill',
  raised = false,
  ref,
  ...props
}: Readonly<
  Omit<ComponentPropsWithoutRef<'input'>, 'size' | 'width'> & {
    size?: keyof typeof inputSizes;
    /** The field's width role; see `inputWidths`. */
    width?: keyof typeof inputWidths;
    /** The composer treatment — for a field that is the point of its screen. */
    raised?: boolean;
    /** Leading content rendered inside the shared input frame. */
    startContent?: ReactNode;
    /** Trailing content rendered inside the shared input frame. */
    endContent?: ReactNode;
    /** Let an interactive trailing target own most of the frame's end padding. */
    endContentFlush?: boolean;
    /** Layout for the frame; `className` continues to target the native input. */
    containerClassName?: string;
    ref?: Ref<HTMLInputElement>;
  }
>) {
  if (!startContent && !endContent) {
    return (
      <input
        ref={ref}
        className={cn(
          inputClasses,
          inputSizes[size],
          inputWidths[width],
          raised && raisedClasses,
          className,
        )}
        {...props}
      />
    );
  }

  return (
    <div
      className={cn(
        'focus-frame bg-input has-[[aria-invalid=true]]:border-danger has-[[aria-invalid=true]]:has-[:enabled]:hover:border-danger flex h-[var(--control-height-md)] w-full items-center gap-2 rounded-[var(--radius-control)] px-3 border border-border transition-[border-color,background-color] has-[:enabled]:hover:border-border-strong',
        size === 'lg' && 'h-[var(--control-height-lg)] px-3',
        raised && raisedClasses,
        props.disabled && 'cursor-not-allowed bg-disabled text-muted border-border-subtle',
        endContentFlush && 'pe-1',
        containerClassName,
      )}
    >
      {startContent ? (
        <span className="text-muted flex shrink-0 items-center">{startContent}</span>
      ) : null}
      <input
        ref={ref}
        className={cn(
          'placeholder:text-muted min-w-0 flex-1 self-stretch bg-transparent text-field text-foreground disabled:cursor-not-allowed disabled:text-muted',
          // Match the frame's control height so selections fill the pill.
          adornedLineHeights[size],
          className,
        )}
        {...props}
      />
      {endContent ? <span className="flex shrink-0 items-center">{endContent}</span> : null}
    </div>
  );
}
