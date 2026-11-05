'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

import { IconButton } from '@/components/ui/button';
import { useReturnFocus } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * Drawer — a sheet for editing or inspecting one item without leaving the
 * list behind it. It floats 8px from the viewport edges, `container-narrow`
 * wide, with `radius-lg` and `shadow-pop` on the scrim. The header (eyebrow,
 * the section title in Geist 500 22/28, description) and the footer are fixed behind 1px
 * `line` rules; only the body scrolls, with `modal-padding` and 16px between
 * blocks. `footerStart` holds a delete or secondary action on the left,
 * `footer` the actions on the right.
 */
export function Drawer({
  open,
  onOpenChange,
  title,
  eyebrow,
  description,
  children,
  footer,
  footerStart,
  body = 'scroll',
  bodyLabel,
  closeLabel = 'Close drawer',
  side = 'right',
  hideHeader = false,
  onAfterClose,
  width = 'narrow',
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  eyebrow?: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  footerStart?: ReactNode;
  /**
   * `scroll`: the body scrolls as one padded column. `dock`: the body is a
   * docked thread — its thread scrolls in its own padded region and a
   * composer docks under it, so the body itself neither scrolls nor pads.
   */
  body?: 'scroll' | 'dock';
  /** Names a scrolling content region when it has independent navigation. */
  bodyLabel?: string;
  closeLabel?: string;
  /** `left` is the app's navigation sheet on a narrow screen. */
  side?: 'left' | 'right';
  /** Keeps the accessible title but removes the visible header. */
  hideHeader?: boolean;
  /** Runs after focus returns to the drawer's opener. */
  onAfterClose?: () => void;
  /**
   * `narrow` (default, `container-narrow`) for one item's fields; `wide`
   * (880px) for evidence that sets an answer beside its sources. The `left`
   * navigation sheet is always 272px.
   */
  width?: 'narrow' | 'wide';
}>) {
  const returnFocus = useReturnFocus(open);
  const Body = bodyLabel ? 'section' : 'div';
  const close = (
    <DialogPrimitive.Close asChild>
      <IconButton
        icon={X}
        label={closeLabel}
        tooltip={false}
        className={hideHeader ? 'absolute top-3 right-3 z-1' : '-me-2 shrink-0'}
      />
    </DialogPrimitive.Close>
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="drawer-overlay bg-scrim z-overlay fixed inset-0" />
        <DialogPrimitive.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          onCloseAutoFocus={(event) => {
            returnFocus(event);
            onAfterClose?.();
          }}
          data-side={side}
          className={cn(
            'drawer-panel bg-surface text-ink shadow-pop z-modal fixed inset-y-2 flex w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-lg',
            side === 'left' ? 'left-2 max-w-68' : 'right-2',
            side === 'right' && (width === 'wide' ? 'max-w-220' : 'max-w-narrow'),
          )}
        >
          <DrawerHeader
            title={title}
            eyebrow={eyebrow}
            description={description}
            hidden={hideHeader}
            close={close}
          />
          <Body
            aria-label={bodyLabel}
            className={cn(
              'min-h-0 flex-1',
              body === 'dock'
                ? 'flex flex-col overflow-hidden'
                : 'flex flex-col gap-4 overflow-x-hidden overflow-y-auto overscroll-contain p-[var(--card-padding)]',
            )}
          >
            {children}
          </Body>
          {footer || footerStart ? (
            <footer className="border-line bg-surface flex items-center justify-between gap-2 border-t px-[var(--card-padding)] py-4">
              <div className="flex items-center gap-2">{footerStart}</div>
              <div className="flex items-center gap-2">{footer}</div>
            </footer>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * The fixed header: eyebrow, title, description and the close button. When
 * `hidden`, the title and description stay for assistive technology only.
 */
function DrawerHeader({
  title,
  eyebrow,
  description,
  hidden,
  close,
}: Readonly<{
  title: ReactNode;
  eyebrow?: string;
  description?: ReactNode;
  hidden: boolean;
  close: ReactNode;
}>) {
  if (hidden) {
    return (
      <>
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="sr-only">
            {description}
          </DialogPrimitive.Description>
        ) : null}
        {close}
      </>
    );
  }
  return (
    <header className="border-line flex items-start justify-between gap-4 border-b px-[var(--card-padding)] py-4">
      <div className="min-w-0">
        {eyebrow ? <p className="type-eyebrow mb-1">{eyebrow}</p> : null}
        <DialogPrimitive.Title className="type-section-title truncate">
          {title}
        </DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description asChild>
            <div className="text-body-sm text-ink-secondary mt-1">{description}</div>
          </DialogPrimitive.Description>
        ) : null}
      </div>
      {close}
    </header>
  );
}
