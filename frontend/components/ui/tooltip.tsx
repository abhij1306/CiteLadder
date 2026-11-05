'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';

/**
 * Tooltip — a short `ink` label that names an icon button or explains a
 * number: `on-ink` 12/16 medium, `radius-sm`, 4/8px padding, 8px from its
 * anchor, no arrow and no shadow. It shows after 300ms on hover and at once on
 * keyboard focus; a shortcut prints as mono `on-ink` text, never a Kbd cap.
 *
 * Every open goes through Radix's pointer and focus handling, which closes any
 * other open tooltip first, so only one is ever open. A tooltip outside any
 * provider brings a provider of its own; the one-open rule still holds.
 */
const Provided = createContext(false);

export function TooltipProvider(props: Readonly<ComponentProps<typeof TooltipPrimitive.Provider>>) {
  return (
    <Provided.Provider value={true}>
      <TooltipPrimitive.Provider delayDuration={300} {...props} />
    </Provided.Provider>
  );
}

export function Tooltip({
  children,
  content,
  side = 'top',
  shortcut,
  describe = true,
  shouldOpen,
}: Readonly<{
  /** The described element, the only child. */
  children: ReactNode;
  /** A phrase, no full stop. */
  content: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  shortcut?: string;
  /**
   * `false` where the trigger's accessible name already is this text (an
   * IconButton), so assistive technology does not hear it twice.
   */
  describe?: boolean;
  /**
   * Asked each time the tooltip is about to open, with its trigger; returning
   * false keeps it closed (e.g. text that turned out not to be cut).
   */
  shouldOpen?: (trigger: HTMLElement) => boolean;
}>) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  // Stable, so Radix's composed trigger ref is not detached on every render.
  const setTrigger = useCallback((node: HTMLElement | null) => {
    trigger.current = node;
  }, []);
  const onOpenChange = (next: boolean) => {
    if (!next || shouldOpen === undefined) {
      setOpen(next);
      return;
    }
    setOpen(trigger.current !== null && shouldOpen(trigger.current));
  };
  const provided = useContext(Provided);
  const tooltip = (
    <TooltipPrimitive.Root delayDuration={300} open={open} onOpenChange={onOpenChange}>
      <TooltipPrimitive.Trigger
        asChild
        ref={setTrigger}
        {...(describe ? {} : { 'aria-describedby': undefined })}
      >
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          className="tooltip-panel bg-ink text-on-ink z-modal text-caption inline-flex max-w-72 items-center gap-2 rounded-sm px-2 py-1 font-medium"
        >
          {content}
          {shortcut ? <span className="text-eyebrow font-mono font-medium">{shortcut}</span> : null}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
  return provided ? tooltip : <TooltipPrimitive.Provider>{tooltip}</TooltipPrimitive.Provider>;
}
