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

import { cn } from '@/lib/utils';

/**
 * Tooltip — Radix. The shared inverse chip uses a dark `bg-surface-inverse`
 * fill with `text-on-inverse` copy and NO border (an inverse chip needs
 * none), so it reads against every surface including a white card (the
 * Phase 1 `bg-elevated` version was ΔE 0.00 against one). Wrap the app (or a
 * subtree) once in <TooltipProvider>; each Tooltip pairs a trigger with
 * short text `content`.
 *
 * Every open goes through Radix's own pointer/focus handling, which closes
 * any other open tooltip first, so only one is ever open and it closes when
 * the pointer or focus leaves. Never mount one already open: Radix does not
 * announce an initial open, so the others would stay up beside it.
 *
 * A tooltip outside any provider (a dialog or flow screen rendered on its
 * own) brings a provider of its own; the one-open rule is document-wide, so
 * it still holds there.
 */
const Provided = createContext(false);

export function TooltipProvider(props: Readonly<ComponentProps<typeof TooltipPrimitive.Provider>>) {
  return (
    <Provided.Provider value={true}>
      <TooltipPrimitive.Provider {...props} />
    </Provided.Provider>
  );
}

export function Tooltip({
  children,
  content,
  side = 'top',
  align = 'center',
  className,
  delayDuration = 200,
  shouldOpen,
}: Readonly<{
  children: ReactNode;
  content: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  className?: string;
  delayDuration?: number;
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
    <TooltipPrimitive.Root delayDuration={delayDuration} open={open} onOpenChange={onOpenChange}>
      <TooltipPrimitive.Trigger asChild ref={setTrigger}>
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          className={cn(
            'tooltip-panel bg-surface-inverse text-on-inverse shadow-overlay z-modal max-w-[18rem] rounded-[var(--radius-card)] px-3 py-2 type-caption text-on-inverse',
            className,
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-surface-inverse" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
  return provided ? tooltip : <TooltipPrimitive.Provider>{tooltip}</TooltipPrimitive.Provider>;
}
