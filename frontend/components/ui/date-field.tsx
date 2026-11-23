import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import { useState } from 'react';

import { Calendar } from '@/components/ui/calendar';
import { FIELD_BOX } from '@/components/ui/input';
import { MENU_PANEL } from '@/components/ui/menu';
import { CalendarDays } from '@/lib/icons';
import { cn } from '@/lib/utils';

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
        disabled && 'cursor-not-allowed opacity-60',
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
        className="type-body placeholder:text-ink-3 min-w-0 flex-1 self-stretch bg-transparent tabular-nums disabled:cursor-not-allowed"
      />
      <DropdownPrimitive.Root open={open} onOpenChange={setOpen}>
        <DropdownPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label={`${ariaLabel}: open calendar`}
            disabled={disabled}
            className="focus-ring text-ink-2 enabled:hover:text-ink not-data-[state=open]:enabled:hover:overlay-hover data-[state=open]:overlay-pressed data-[state=open]:text-ink rounded-mark hit-area inline-flex size-[var(--target-min)] shrink-0 items-center justify-center transition-colors"
          >
            <CalendarDays className="size-3.5" aria-hidden />
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
