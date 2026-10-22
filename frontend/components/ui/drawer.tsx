'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useInsertionEffect, useRef, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Accessible right-side sheet for contextual evidence and detail. */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  body = 'scroll',
  bodyLabel,
  closeLabel = 'Close drawer',
  side = 'right',
  hideHeader = false,
  onAfterClose,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  /**
   * `scroll`: the body scrolls as one padded column. `dock`: the body is a
   * `DockedThread` — its content scrolls and a composer docks to the bottom
   * edge, so the body drops its bottom inset and lays out as a column.
   */
  body?: 'scroll' | 'dock';
  /** Names a scrolling content region when it has independent navigation. */
  bodyLabel?: string;
  closeLabel?: string;
  side?: 'left' | 'right';
  /** Keeps the accessible title but removes duplicate visual drawer chrome. */
  hideHeader?: boolean;
  /** Runs after Radix restores focus to the drawer's original opener. */
  onAfterClose?: () => void;
}>) {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  // A labelled body is a named region; an unlabelled one stays a plain box.
  const Body = bodyLabel ? 'section' : 'div';

  useInsertionEffect(() => {
    if (open && !wasOpenRef.current) {
      const activeElement = document.activeElement;
      returnFocusRef.current =
        activeElement instanceof HTMLElement &&
        activeElement !== document.body &&
        activeElement !== document.documentElement &&
        activeElement.isConnected
          ? activeElement
          : null;
    }
    wasOpenRef.current = open;
  }, [open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="drawer-overlay bg-overlay-scrim z-overlay fixed inset-0" />
        <DialogPrimitive.Content
          onCloseAutoFocus={(event) => {
            const returnTarget = returnFocusRef.current;
            if (returnTarget?.isConnected) {
              event.preventDefault();
              returnTarget.focus();
            }
            returnFocusRef.current = null;
            onAfterClose?.();
          }}
          data-side={side}
          className={cn(
            'drawer-panel border-transparent bg-elevated shadow-modal z-modal fixed inset-y-0 flex w-full max-w-[32.5rem] flex-col focus-ring',
            side === 'left'
              ? 'left-0 rounded-r-[var(--radius-card)] border-r'
              : 'right-0 rounded-l-[var(--radius-card)] border-l',
            className,
          )}
        >
          {hideHeader ? (
            <>
              <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="sr-only">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
              <DialogPrimitive.Close asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={closeLabel}
                  className="absolute top-3 right-3 z-1"
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </DialogPrimitive.Close>
            </>
          ) : (
            <header className="border-border flex items-start justify-between gap-3 border-b p-[var(--modal-padding)]">
              <div className="min-w-0">
                <DialogPrimitive.Title className="type-section-title truncate">
                  {title}
                </DialogPrimitive.Title>
                {description ? (
                  <DialogPrimitive.Description className="type-body mt-1">
                    {description}
                  </DialogPrimitive.Description>
                ) : null}
              </div>
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" aria-label={closeLabel}>
                  <X className="size-4" aria-hidden />
                </Button>
              </DialogPrimitive.Close>
            </header>
          )}
          <Body
            aria-label={bodyLabel}
            className={cn(
              'min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-[var(--modal-padding)] py-4',
              body === 'dock' && 'flex flex-col pb-0',
            )}
          >
            {children}
          </Body>
          {footer ? (
            <footer className="border-border border-t px-[var(--modal-padding)] pt-4 pb-[var(--modal-padding)]">
              {footer}
            </footer>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
