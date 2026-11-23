import * as PopoverPrimitive from '@radix-ui/react-popover';
import { useId, useState, type ReactNode } from 'react';

import { focusFromKeyboard } from '@/components/ui/input-modality';
import { TOOLTIP_SHEET } from '@/components/ui/tooltip';
import { Info } from '@/lib/icons';
import { cn } from '@/lib/utils';

export function InfoHint({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  const [open, setOpen] = useState(false);
  const descriptionId = useId();
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        aria-label={label}
        aria-describedby={descriptionId}
        aria-haspopup={undefined}
        aria-expanded={undefined}
        aria-controls={undefined}
        onFocus={() => {
          if (focusFromKeyboard()) setOpen(true);
        }}
        className="focus-ring text-ink-2 hover:text-ink -m-2 inline-flex size-[var(--control-md)] items-center justify-center align-middle"
      >
        <Info className="size-3.5" aria-hidden />
      </PopoverPrimitive.Trigger>
      <span id={descriptionId} hidden>
        {children}
      </span>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          role="tooltip"
          side="top"
          sideOffset={8}
          avoidCollisions
          collisionPadding={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          className={cn(TOOLTIP_SHEET, 'popover-panel')}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
