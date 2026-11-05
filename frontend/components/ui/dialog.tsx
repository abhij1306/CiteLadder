'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AlertTriangle, X } from 'lucide-react';
import { useInsertionEffect, useRef, type ReactNode, type RefObject } from 'react';

import { cn } from '@/lib/utils';
import { Button, IconButton } from './button';
import { Icon } from './icon';

/**
 * Remembers the element that opened an overlay, so closing returns focus to
 * it even when Radix's own trigger is not the opener.
 */
export function useReturnFocus(open: boolean) {
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
  return (event: Event) => {
    const returnTarget = returnFocusRef.current;
    returnFocusRef.current = null;
    if (!returnTarget?.isConnected) return;
    event.preventDefault();
    returnTarget.focus();
  };
}

/**
 * Dialog — a modal panel for one short task, centred on the scrim: `surface`,
 * `radius-lg`, `shadow-pop`, `modal-padding` (16 in the app) padding and gaps, `container-narrow` wide.
 * The title is the section title (Geist 500 22/28), the description
 * `ink-secondary`, the footer right-aligned (Cancel first, then the action). `tone="danger"` is a
 * confirmation: an `alertdialog`, 440px, a `negative` warning icon by the
 * title and no close button, so the person picks Cancel or the named action.
 * Focus opens on the first tabbable element unless `initialFocusRef` is set,
 * and returns to the opener on close.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  tone = 'default',
  width = 'narrow',
  initialFocusRef,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  tone?: 'default' | 'danger';
  /**
   * `wide` (720px) only for a side-by-side review the narrow panel cannot
   * hold (two calendar months, a CSV preview); a long form is a Drawer.
   */
  width?: 'narrow' | 'wide';
  initialFocusRef?: RefObject<HTMLElement | null>;
}>) {
  const returnFocus = useReturnFocus(open);
  const danger = tone === 'danger';

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay bg-scrim z-overlay fixed inset-0" />
        <DialogPrimitive.Content
          role={danger ? 'alertdialog' : 'dialog'}
          {...(description ? {} : { 'aria-describedby': undefined })}
          onOpenAutoFocus={(event) => {
            if (!initialFocusRef?.current) return;
            event.preventDefault();
            initialFocusRef.current.focus();
          }}
          onCloseAutoFocus={returnFocus}
          className={cn(
            'dialog-panel bg-surface text-ink shadow-pop z-modal fixed top-1/2 left-1/2 flex max-h-[calc(100dvh-3rem)] w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-[var(--card-padding)] rounded-lg p-[var(--card-padding)]',
            danger && 'max-w-110',
            !danger && (width === 'wide' ? 'max-w-180' : 'max-w-narrow'),
          )}
        >
          <header className={cn('flex items-start gap-3', !danger && 'pe-8')}>
            {danger ? (
              <span className="text-negative inline-flex h-7 items-center">
                <Icon icon={AlertTriangle} className="my-0" />
              </span>
            ) : null}
            <div className="min-w-0">
              <DialogPrimitive.Title className="type-section-title">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description asChild>
                  <div className="text-body-sm text-ink-secondary mt-2">{description}</div>
                </DialogPrimitive.Description>
              ) : null}
            </div>
          </header>
          {danger ? null : (
            <DialogPrimitive.Close asChild>
              <IconButton
                icon={X}
                label="Close dialog"
                tooltip={false}
                className="absolute top-4 right-4"
              />
            </DialogPrimitive.Close>
          )}
          {children == null ? null : (
            <div className="text-ink -mx-[var(--card-padding)] flex min-h-0 flex-1 flex-col gap-4 overflow-auto overscroll-contain px-[var(--card-padding)]">
              {children}
            </div>
          )}
          {footer ? (
            <footer className="flex items-center justify-end gap-2">{footer}</footer>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export type ConfirmRequest = {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
};

/**
 * Ask before an action that is hard to undo. Closed while `request` is null;
 * the confirm button names exactly what will happen ("Stop tracking", never
 * "OK"), and Cancel stays the safe default.
 */
export function ConfirmDialog({
  request,
  onCancel,
  pending = false,
}: Readonly<{
  request: ConfirmRequest | null;
  onCancel: () => void;
  pending?: boolean;
}>) {
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
      tone={request?.destructive ? 'danger' : 'default'}
      title={request?.title ?? ''}
      description={request?.body}
      footer={
        <>
          <Button onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={request?.destructive ? 'danger' : 'primary'}
            onClick={request?.onConfirm}
            disabled={pending}
            pending={pending}
          >
            {request?.confirmLabel}
          </Button>
        </>
      }
    />
  );
}
