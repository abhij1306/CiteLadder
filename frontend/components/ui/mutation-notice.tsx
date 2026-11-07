import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import type { MutationNotice as MutationNoticeData } from '@/lib/api/mutation-notice';

/**
 * The shared failure notice (A4/A6, F8): a negative Callout, and with
 * `ReadError` the only way a failure renders in the app.
 *
 * Renders the A4 policy copy (`mutationNoticeForError`): the backend message
 * verbatim for 4xx preconditions, transient "try again" copy for
 * 5xx/network/timeout failures. The callout's action is, in order: the
 * owner's `recovery` (the step that fixes the failure — rerun, reconnect,
 * edit the input, start a new chat), Try again when the failure is retryable
 * and `onRetry` is given, or See plans for a refusal a bigger plan can lift.
 * The support line always surfaces the machine `code` / `X-Request-ID` when
 * the API sent them, so a user report maps straight to backend logs (A6).
 */
export function MutationNotice({
  notice,
  onRetry,
  recovery,
  className,
}: Readonly<{
  notice: MutationNoticeData;
  /** Retry affordance — rendered only when the failure is transient. */
  onRetry?: () => void;
  /** The action that recovers this failure; replaces Try again when given. */
  recovery?: ReactNode;
  className?: string;
}>) {
  const correlation = [
    notice.code ? `code ${notice.code}` : null,
    notice.requestId ? `ref ${notice.requestId}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  let action: ReactNode = recovery ?? null;
  if (action === null && notice.retryable && onRetry)
    action = (
      <Button type="button" onClick={onRetry}>
        Try again
      </Button>
    );
  return (
    <Callout tone="negative" className={className} action={action}>
      <span className="block">{notice.message}</span>
      {correlation ? (
        <span className="text-ink-secondary text-caption block">Support: {correlation}</span>
      ) : null}
    </Callout>
  );
}
