import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { MutationNotice as MutationNoticeData } from '@/lib/api/mutation-notice';

/**
 * The shared mutation-failure notice (A4/A6).
 *
 * Renders the A4 policy copy (`mutationNoticeForError`): the backend message
 * verbatim for 4xx preconditions, transient "try again" copy for
 * 5xx/network/timeout failures. When the failure is retryable and `onRetry`
 * is given, a Try again control provides the retry affordance. The support
 * line always surfaces the machine `code` / `X-Request-ID` when the API sent
 * them, so a user report maps straight to backend logs (A6).
 */
export function MutationNotice({
  notice,
  onRetry,
  className,
}: Readonly<{
  notice: MutationNoticeData;
  /** Retry affordance — rendered only when the failure is transient. */
  onRetry?: () => void;
  className?: string;
}>) {
  const correlation = [
    notice.code ? `code ${notice.code}` : null,
    notice.requestId ? `ref ${notice.requestId}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Alert tone="danger" className={className}>
      <div className="grid gap-1">
        <span>{notice.message}</span>
        {notice.retryable && onRetry ? (
          <div>
            <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : null}
        {correlation ? <span className="type-caption">Support: {correlation}</span> : null}
      </div>
    </Alert>
  );
}
