import type { ReactNode } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { humanizeApiError } from '@/lib/api/errors';

/** The read a `ReadError` reports on and retries: a TanStack query, or its shape. */
export type RetryableRead = Readonly<{
  error: unknown;
  refetch: () => unknown;
  isFetching: boolean;
}>;

/**
 * `ReadError`'s read props from one query: its error, a retry of exactly that
 * read, and the pending state while the retry is in flight.
 */
export function readErrorProps(read: RetryableRead) {
  return {
    error: read.error,
    onRetry: () => void read.refetch(),
    pending: read.isFetching,
  };
}

/**
 * Scoped recovery for a failed persisted read.
 *
 * The owner chooses which exact read to retry; this presentation component
 * intentionally has no query-key or network knowledge.
 */
export function ReadError({
  error,
  fallback,
  onRetry,
  pending = false,
  className,
}: Readonly<{
  error: unknown;
  fallback: string;
  onRetry: () => void;
  pending?: boolean;
  className?: string;
}>) {
  const detail = humanizeApiError(error, fallback);
  const accessFailure = detail.status === 401 || detail.status === 403;
  const retryable = detail.retryable !== false && !accessFailure;
  // Three outcomes, not two: a retryable read gets the button, a 401/403 gets
  // the one instruction that helps, and anything else gets neither.
  let recovery: ReactNode = null;
  if (retryable) {
    recovery = (
      <Button
        variant="secondary"
        size="sm"
        className="w-fit"
        onClick={onRetry}
        pending={pending}
        pendingLabel="Retrying…"
      >
        Retry
      </Button>
    );
  } else if (accessFailure) {
    recovery = (
      <p className="type-caption text-current">Check your workspace access, then try again.</p>
    );
  }
  return (
    <Alert tone="danger" className={className}>
      <div className="grid gap-3">
        <p>{detail.message}</p>
        {recovery}
        {detail.requestId ? <p className="type-caption">Reference: {detail.requestId}</p> : null}
      </div>
    </Alert>
  );
}
