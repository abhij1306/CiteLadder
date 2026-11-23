import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useInsertionEffect, useRef, type ReactNode } from 'react';

import { AlertTriangle, X } from '@/lib/icons';
import { cn } from '@/lib/utils';
import { Button, IconButton } from './button';
import { Icon } from './icon';
import { SHEET_FACE } from '@/components/ui/slip';

export const SCRIM = 'bg-scrim z-overlay fixed inset-0';

function opener(active: Element | null) {
  if (!(active instanceof HTMLElement) || active === document.body) return null;
  if (active === document.documentElement) return null;
  const id = active.closest('[role="menu"]')?.getAttribute('aria-labelledby');
  return (id && document.getElementById(id)) || active;
}

const FIELD =
  'input:not([type=hidden], [type=checkbox], [type=radio], [type=button], [type=submit], [type=reset]), textarea, select';
const CONTROL =
  'input:not([type=hidden]), textarea, select, button, a[href], [tabindex]:not([tabindex="-1"])';

function leadingField(content: EventTarget | null): HTMLElement | null {
  if (!(content instanceof HTMLElement)) return null;
  const first = [
    ...(content.querySelector('[data-dialog-body]')?.querySelectorAll<HTMLElement>(CONTROL) ?? []),
  ].find((node) => !node.matches(':disabled'));
  return first?.matches(FIELD) ? first : null;
}
const shown = (node: HTMLElement) => node.checkVisibility?.() ?? true;

export function returnTargetFor(node: HTMLElement | null) {
  if (!node?.isConnected || shown(node)) return node?.isConnected ? node : null;
  const folder = node.closest<HTMLElement>('[data-folded-by]')?.dataset.foldedBy;
  const more = folder
    ? document.querySelector<HTMLElement>(`[data-folds="${CSS.escape(folder)}"]`)
    : null;
  if (more && shown(more)) return more;
  const controls = [...document.querySelectorAll<HTMLElement>('[aria-controls]')].filter(shown);
  for (let region = node.parentElement; region; region = region.parentElement) {
    const { id } = region;
    const control = controls.find(
      (c) => id && c.getAttribute('aria-controls')?.split(' ').includes(id),
    );
    if (control) return control;
  }
  return null;
}

export function useReturnFocus(open: boolean) {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  useInsertionEffect(() => {
    if (open && !wasOpenRef.current) returnFocusRef.current = opener(document.activeElement);
    wasOpenRef.current = open;
  }, [open]);
  return (event: Event) => {
    const returnTarget = returnTargetFor(returnFocusRef.current);
    returnFocusRef.current = null;
    if (!returnTarget) return;
    event.preventDefault();
    returnTarget.focus();
  };
}

function DialogHeader({
  title,
  description,
  toolbar,
  danger,
  divided,
}: Readonly<{
  title: ReactNode;
  description?: ReactNode;
  toolbar?: ReactNode;
  danger: boolean;
  divided: boolean;
}>) {
  return (
    <header
      className={cn(
        'flex items-start gap-3 p-[var(--card-padding)]',
        !danger && 'pe-14',
        divided && 'border-rule border-b',
      )}
    >
      {danger ? (
        <span className="text-negative inline-flex h-7 items-center">
          <Icon icon={AlertTriangle} className="my-0" />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <DialogPrimitive.Title className="type-heading text-balance">{title}</DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description asChild>
            <div className="text-body-sm text-ink-2 mt-1">{description}</div>
          </DialogPrimitive.Description>
        ) : null}
        {toolbar ? (
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">{toolbar}</div>
        ) : null}
      </div>
    </header>
  );
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  toolbar,
  tone = 'default',
  width = 'narrow',
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  toolbar?: ReactNode;
  tone?: 'default' | 'danger';
  width?: 'narrow' | 'wide' | 'prose' | 'answer';
}>) {
  const returnFocus = useReturnFocus(open);
  const danger = tone === 'danger';
  const answer = !danger && width === 'answer';

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={cn('dialog-overlay', SCRIM)} />
        <DialogPrimitive.Content
          role={danger ? 'alertdialog' : 'dialog'}
          {...(description ? {} : { 'aria-describedby': undefined })}
          onOpenAutoFocus={(event) => {
            const target = leadingField(event.target);
            if (!target) return;
            event.preventDefault();
            target.focus();
          }}
          onCloseAutoFocus={returnFocus}
          className={cn(
            SHEET_FACE,
            'dialog-panel z-modal fixed left-1/2 flex w-[calc(100vw-3rem)] -translate-x-1/2 flex-col overflow-hidden',
            answer
              ? 'max-w-answer top-16 h-full max-h-[calc(100dvh-8rem)]'
              : 'top-[12dvh] max-h-[calc(88dvh-1.5rem)]',
            !answer && overlayWidth(danger || width === 'answer' ? 'narrow' : width),
          )}
        >
          <DialogHeader
            title={title}
            description={description}
            toolbar={toolbar}
            danger={danger}
            divided={children != null}
          />
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
            <div
              data-dialog-body=""
              className="text-ink flex min-h-0 flex-1 flex-col gap-4 overflow-auto overscroll-contain p-[var(--card-padding)]"
            >
              {children}
            </div>
          )}
          {footer ? (
            <footer className="border-rule flex items-center justify-end gap-2 border-t px-[var(--card-padding)] py-3">
              {footer}
            </footer>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function overlayWidth(width: 'narrow' | 'wide' | 'prose'): string {
  switch (width) {
    case 'narrow':
      return 'max-w-flow';
    case 'wide':
      return 'max-w-form';
    case 'prose':
      return 'max-w-[var(--container-prose)]';
    default: {
      const unhandled: never = width;
      return unhandled;
    }
  }
}

export type ConfirmRequest = {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
};

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
            variant={request?.destructive ? 'danger-confirm' : 'primary'}
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
