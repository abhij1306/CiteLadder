'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Tooltip — Radix. The shared inverse chip uses a dark `bg-surface-inverse`
 * fill with `text-on-inverse` copy and NO border (an inverse chip needs
 * none), so it reads against every surface including a white card (the
 * Phase 1 `bg-elevated` version was ΔE 0.00 against one). Wrap the app (or a
 * subtree) once in <TooltipProvider>; each Tooltip pairs a trigger with
 * short text `content`.
 */
export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  children,
  content,
  side = 'top',
  align = 'center',
  className,
  delayDuration = 200,
  defaultOpen,
}: Readonly<{
  children: ReactNode;
  content: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  className?: string;
  delayDuration?: number;
  /** Open on mount — for a tooltip mounted in response to the pointer already being there. */
  defaultOpen?: boolean;
}>) {
  return (
    <TooltipPrimitive.Root delayDuration={delayDuration} defaultOpen={defaultOpen}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
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
}
