'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useInsertionEffect, useRef, type ReactNode, type RefObject } from 'react';

import { cn } from '@/lib/utils';
import { IconButton } from './button';

/**
 * Dialog — Radix modal. Scrim = --color-overlay-scrim, surface = bg-elevated,
 * shadow-modal, and the shared overlay radius. Header, body, and footer use
 * the modal-padding rhythm and include a built-in close button. Focus opens on
 * the first tabbable element (the close button) unless `initialFocusRef` is set.
 *
 * Width is a role, never a number a caller picks: `form` (30rem) for a short
 * form or a confirmation, `wide` (45rem) for a dialog that lays out a
 * selection grid, a preview or a long form with rows of paired fields, and
 * `review` (51.25rem) for a dialog whose body is a table or a review list the
 * reader works through row by row.
 */
const DIALOG_WIDTH = {
  form: 'w-[30rem]',
  wide: 'w-180',
  review: 'w-205',
} as const;

export type DialogWidth = keyof typeof DIALOG_WIDTH;

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 'form',
  initialFocusRef,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: DialogWidth;
  initialFocusRef?: RefObject<HTMLElement | null>;
}>) {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

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
        <DialogPrimitive.Overlay className="dialog-overlay bg-overlay-scrim z-overlay fixed inset-0" />
        <DialogPrimitive.Content
          // Without a description, opt out of the one Radix otherwise wires up
          // and warns about. With one, Radix's own id must stay in place.
          {...(description ? {} : { 'aria-describedby': undefined })}
          onOpenAutoFocus={(event) => {
            if (!initialFocusRef?.current) return;
            event.preventDefault();
            initialFocusRef.current.focus();
          }}
          onCloseAutoFocus={(event) => {
            const returnTarget = returnFocusRef.current;
            if (!returnTarget?.isConnected) return;
            event.preventDefault();
            returnTarget.focus();
            returnFocusRef.current = null;
          }}
          className={cn(
            'dialog-panel border-transparent bg-elevated shadow-modal z-modal fixed top-1/2 left-1/2 flex max-h-[calc(100dvh-2.5rem)] max-w-[calc(100vw-2.5rem)] min-w-0 -translate-x-1/2 -translate-y-1/2 flex-col box-border rounded-[var(--radius-card)] border focus-ring',
            DIALOG_WIDTH[width],
          )}
        >
          <header className="border-border flex items-start justify-between gap-4 border-b px-[var(--modal-padding)] pt-[var(--modal-padding)] pb-4">
            <div className="grid min-w-0 gap-1">
              <DialogPrimitive.Title className="type-section-title">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="type-body">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close asChild>
              <IconButton icon={X} label="Close dialog" />
            </DialogPrimitive.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-[var(--modal-padding)] py-4">
            {children}
          </div>
          {footer ? (
            <footer className="border-border flex items-center justify-end gap-2 border-t px-[var(--modal-padding)] pt-4 pb-[var(--modal-padding)]">
              {footer}
            </footer>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
