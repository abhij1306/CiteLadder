import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
import type { LucideIcon } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

/**
 * The field box every text control shares (Input, SearchField, Select's
 * trigger, ChipInput): `surface` with a soft 1px `line` edge and the faint
 * `shadow-edge` smudge under it, never a dark hairline (decision D5),
 * `radius-md`, `control-md` tall. Hover steps the edge to `line-strong`;
 * focus turns it `focus` with a 3px `line` halo, and an invalid field turns
 * it `negative` (globals.css `.focus-input`/`.focus-frame`, which win over hover).
 */
export const FIELD_EDGE = 'bg-surface shadow-edge border border-line hover:border-line-strong';

export const FIELD_BOX = `${FIELD_EDGE} h-[var(--control-md)] w-full rounded-md px-3 text-body-sm text-ink transition-[border-color,box-shadow] duration-[var(--motion-fast)]`;

/**
 * A field fills its column (`fill`) unless its role is narrower: `quantity`
 * is a small count beside the control that acts on it (4rem, centred,
 * tabular figures), so every quantity picker reads at one width.
 */
const inputWidths = {
  fill: '',
  quantity: 'w-16 text-center tabular-nums',
} as const;

/**
 * Input — the single-line text field. One form: 36px. Leading and trailing
 * content (a mono affix such as "https://", an icon, the end button) sits
 * inside the same box.
 */
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
    /** The field's width role; see `inputWidths`. */
    width?: keyof typeof inputWidths;
    /** Leading content inside the field box. */
    startContent?: ReactNode;
    /** Trailing content inside the field box. */
    endContent?: ReactNode;
    /** Let an interactive trailing target own most of the box's end padding. */
    endContentFlush?: boolean;
    /** Layout for the box; `className` continues to target the native input. */
    containerClassName?: string;
    ref?: Ref<HTMLInputElement>;
  }
>) {
  if (!startContent && !endContent) {
    // A bare field is its own box, so an adorned and a bare field given the
    // same layout render the same height.
    return (
      <input
        ref={ref}
        className={cn(
          'focus-input',
          FIELD_BOX,
          'placeholder:text-ink-muted disabled:cursor-not-allowed disabled:opacity-45',
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
      className={cn(
        'focus-frame flex items-center gap-2',
        FIELD_BOX,
        props.disabled && 'cursor-not-allowed opacity-45',
        endContentFlush && 'pe-1',
        containerClassName,
      )}
    >
      {startContent ? (
        <span className="text-ink-muted text-data flex shrink-0 items-center font-mono whitespace-nowrap">
          {startContent}
        </span>
      ) : null}
      <input
        ref={ref}
        className={cn(
          'placeholder:text-ink-muted h-full min-w-0 flex-1 bg-transparent text-body-sm text-ink disabled:cursor-not-allowed',
          className,
        )}
        {...props}
      />
      {endContent ? (
        <span className="text-ink-muted text-data flex shrink-0 items-center font-mono whitespace-nowrap">
          {endContent}
        </span>
      ) : null}
    </div>
  );
}

/**
 * FieldEndButton — the one icon target at a field's end (clear a search,
 * reveal a password): SearchField's clear face, a 20px `radius-xs` square
 * with the 16px glyph, `ink-muted` until hovered, its focus ring 1px out.
 * Pass it as an `Input`'s `endContent`. `label` is its accessible name.
 */
export function FieldEndButton({
  icon,
  label,
  onClick,
  disabled,
}: Readonly<{
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}>) {
  return (
    <button
      type="button"
      data-field-end-target=""
      className="focus-ring text-ink-muted enabled:hover:bg-surface-sunken enabled:hover:text-ink grid size-5 shrink-0 place-items-center rounded-xs transition-colors focus-visible:outline-offset-1"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
    >
      <Icon icon={icon} />
    </button>
  );
}
