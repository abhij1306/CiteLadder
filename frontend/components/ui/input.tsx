import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';

import { Icon } from '@/components/ui/icon';
import type { IconGlyph } from '@/lib/icons';
import { cn } from '@/lib/utils';

export const FIELD_EDGE =
  'bg-panel border border-rule hover:border-control-line [[data-public-surface]_&]:shadow-edge';

const FIELD_SHAPE =
  'type-body min-h-[var(--control-md)] w-full rounded-control px-3 text-ink transition-[background-color,border-color,outline-color] duration-[var(--motion-fast)]';

export const FIELD_BOX = `${FIELD_EDGE} ${FIELD_SHAPE}`;

export const TRIGGER_BOX = `face bg-raised border border-rule hover:bg-raised-2 data-[state=open]:bg-raised-2 ${FIELD_SHAPE}`;

const inputWidths = {
  fill: '',
  quantity: 'w-16 text-center tabular-nums',
} as const;

export function Input({
  className,
  containerClassName,
  startContent,
  endContent,
  endContentFlush = false,
  width = 'fill',
  ref,
  ...props
}: Readonly<
  Omit<ComponentPropsWithoutRef<'input'>, 'size' | 'width'> & {
    width?: keyof typeof inputWidths;
    startContent?: ReactNode;
    endContent?: ReactNode;
    endContentFlush?: boolean;
    containerClassName?: string;
    ref?: Ref<HTMLInputElement>;
  }
>) {
  if (!startContent && !endContent) {
    return (
      <input
        ref={ref}
        className={cn(
          'focus-input',
          FIELD_BOX,
          'placeholder:text-ink-2 disabled:cursor-not-allowed disabled:opacity-60',
          inputWidths[width],
          containerClassName,
          className,
        )}
        {...props}
      />
    );
  }

  return (
    <div
      data-disabled={props.disabled || String(props['aria-disabled']) === 'true' || undefined}
      className={cn(
        'focus-frame flex items-center gap-2',
        FIELD_BOX,
        props.disabled && 'cursor-not-allowed opacity-60',
        endContentFlush && 'pe-1',
        containerClassName,
      )}
    >
      {startContent ? (
        <span className="type-caption flex shrink-0 items-center whitespace-nowrap tabular-nums">
          {startContent}
        </span>
      ) : null}
      <input
        ref={ref}
        className={cn(
          'placeholder:text-ink-2 type-body min-w-0 flex-1 self-stretch bg-transparent disabled:cursor-not-allowed',
          className,
        )}
        {...props}
      />
      {endContent ? (
        <span className="type-caption flex shrink-0 items-center whitespace-nowrap tabular-nums">
          {endContent}
        </span>
      ) : null}
    </div>
  );
}

export function FieldEndButton({
  icon,
  label,
  onClick,
  disabled,
}: Readonly<{
  icon: IconGlyph;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}>) {
  return (
    <button
      type="button"
      data-field-end-target=""
      className="focus-ring text-ink-2 enabled:hover:overlay-hover enabled:hover:text-ink rounded-mark hit-area grid size-[var(--target-min)] shrink-0 place-items-center transition-colors"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
    >
      <Icon icon={icon} />
    </button>
  );
}
