import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import { CalendarDays } from 'lucide-react';
import { useState } from 'react';

import { Calendar } from '@/components/ui/calendar';
import { FIELD_BOX } from '@/components/ui/input';
import { MENU_PANEL } from '@/components/ui/menu';
import { cn } from '@/lib/utils';

/**
 * DateField — an ISO date input with a calendar picker beside it.
 *
 * Replaces `<input type="date">`, whose popup is drawn by the BROWSER: it
 * ignores the design tokens entirely, and differs between Chrome, Safari and
 * Firefox, so the one control on the surface that opened a picker looked like
 * no other control in the product. The text input stays — typing a date is
 * often faster than clicking to it, and it keeps the field usable with a
 * keyboard alone — and the button opens the token-styled `Calendar`.
 *
 * The value is an ISO `YYYY-MM-DD` string throughout (see `Calendar` for why
 * a `Date` would be the wrong currency here).
 */
export function DateField({
  value,
  onChange,
  min,
  max,
  ariaLabel,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  invalid = false,
  disabled = false,
  className,
}: Readonly<{
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  ariaLabel: string;
  id?: string;
  'aria-describedby'?: string;
  /** Accepts `aria-invalid` directly, so it drops into a `Field` render prop. */
  'aria-invalid'?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
}>) {
  const [open, setOpen] = useState(false);
  const isInvalid = invalid || ariaInvalid === true;
  return (
    <div
      className={cn(
        'focus-frame flex items-center gap-2 pe-1',
        FIELD_BOX,
        disabled && 'cursor-not-allowed opacity-45',
        className,
      )}
    >
      <input
        id={id}
        type="text"
        inputMode="numeric"
        placeholder="YYYY-MM-DD"
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={isInvalid || undefined}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="text-ink placeholder:text-ink-muted text-body-sm h-full min-w-0 flex-1 bg-transparent font-mono tabular-nums disabled:cursor-not-allowed"
      />
      <DropdownPrimitive.Root open={open} onOpenChange={setOpen}>
        <DropdownPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label={`${ariaLabel}: open calendar`}
            disabled={disabled}
            className="focus-ring text-ink-muted enabled:hover:text-ink not-data-[state=open]:enabled:hover:overlay-hover data-[state=open]:overlay-pressed data-[state=open]:text-ink inline-flex size-[var(--field-end-target)] shrink-0 items-center justify-center rounded-xs transition-colors"
          >
            <CalendarDays className="size-4" aria-hidden />
          </button>
        </DropdownPrimitive.Trigger>
        <DropdownPrimitive.Portal>
          <DropdownPrimitive.Content
            align="end"
            sideOffset={6}
            collisionPadding={8}
            className={cn(MENU_PANEL, 'p-2')}
          >
            <Calendar
              value={value}
              min={min}
              max={max}
              ariaLabel={ariaLabel}
              onSelect={(iso) => {
                onChange(iso);
                setOpen(false);
              }}
            />
          </DropdownPrimitive.Content>
        </DropdownPrimitive.Portal>
      </DropdownPrimitive.Root>
    </div>
  );
}
