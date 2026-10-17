import type { ReactNode } from 'react';

import { Button } from './button';
import { Dialog } from './dialog';

export type ConfirmRequest = {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
};

/**
 * Ask before an action that is hard to undo. Closed while `request` is null;
 * the confirm button says exactly what will happen, and Cancel stays the safe
 * default.
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
      title={request?.title ?? ''}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={request?.destructive ? 'destructive' : 'primary'}
            onClick={request?.onConfirm}
            disabled={pending}
            pending={pending}
          >
            {request?.confirmLabel}
          </Button>
        </>
      }
    >
      <div className="type-body">{request?.body}</div>
    </Dialog>
  );
}
