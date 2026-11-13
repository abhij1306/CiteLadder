import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
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
 * Scoped recovery for a failed persisted read: a negative Callout saying what
 * happened, Retry for exactly that read as its action, and the support
 * reference. The owner chooses which read to retry; this has no query-key or
 * network knowledge.
 */
export function ReadError({
  error,
  fallback,
  onRetry,
  pending = false,
  title,
}: Readonly<{
  error: unknown;
  fallback: string;
  onRetry: () => void;
  pending?: boolean;
  /** Names what failed to load ("Couldn't load the business map"); the error's message follows it. */
  title?: string;
}>) {
  const detail = humanizeApiError(error, fallback);
  const accessFailure = detail.status === 401 || detail.status === 403;
  const retryable = detail.retryable !== false && !accessFailure;
  let action: ReactNode = null;
  if (retryable) {
    action = (
      <Button onClick={onRetry} pending={pending} pendingLabel="Retrying…">
        Retry
      </Button>
    );
  }
  return (
    <Callout tone="negative" title={title} action={action}>
      <p>{detail.message}</p>
      {accessFailure ? <p>Check your workspace access, then try again.</p> : null}
      {detail.requestId ? <p className="text-caption">Reference: {detail.requestId}</p> : null}
    </Callout>
  );
}
