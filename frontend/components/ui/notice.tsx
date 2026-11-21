import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { TextLink } from '@/components/ui/text-link';
import { Tooltip } from '@/components/ui/tooltip';
import { textRole } from '@/components/ui/typography';
import { humanizeApiError } from '@/lib/api/errors';
import type { MutationNotice as MutationNoticeData } from '@/lib/api/mutation-notice';
import { isPlanLimit, PLANS_HREF } from '@/lib/billing/plan-limit';
import { cn } from '@/lib/utils';

export type NoticeTone = 'info' | 'positive' | 'warning' | 'negative';

const TONE: Record<NoticeTone, { dot: string; word: string }> = {
  info: { dot: 'bg-info', word: 'Note' },
  positive: { dot: 'bg-positive', word: 'Done' },
  warning: { dot: 'bg-warning', word: 'Warning' },
  negative: { dot: 'bg-negative', word: 'Error' },
};

type MessageNotice = Readonly<{
  kind?: 'message';
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  standing?: boolean;
  className?: string;
}>;

type MutationFailure = Readonly<{
  kind: 'mutation';
  notice: MutationNoticeData;
  onRetry?: () => void;
  recovery?: ReactNode;
  className?: string;
}>;

type ReadFailure = Readonly<{
  kind: 'read';
  error: unknown;
  fallback: string;
  onRetry: () => void;
  pending?: boolean;
  title: string;
  className?: string;
}>;

export type NoticeProps = MessageNotice | MutationFailure | ReadFailure;

export type RetryableRead = Readonly<{
  error: unknown;
  refetch: () => unknown;
  isFetching: boolean;
}>;

export function readErrorProps(read: RetryableRead) {
  return {
    error: read.error,
    onRetry: () => void read.refetch(),
    pending: read.isFetching,
  };
}

export function Notice(props: NoticeProps) {
  switch (props.kind) {
    case 'mutation':
      return <MutationFailureNotice {...props} />;
    case 'read':
      return <ReadFailureNotice {...props} />;
    case undefined:
    case 'message':
      return <MessageNoticeView {...props} />;
    default: {
      const unreachable: never = props;
      return unreachable;
    }
  }
}

function MessageNoticeView({
  tone = 'info',
  title,
  children,
  action,
  standing = false,
  className,
}: MessageNotice) {
  if (children == null && title == null) return null;
  const style = TONE[tone];
  const word = <span className="sr-only">{`${style.word}: `}</span>;
  const urgent = !standing && (tone === 'negative' || tone === 'warning');
  const Root = urgent || standing ? 'div' : 'output';
  return (
    <Root
      role={urgent ? 'alert' : undefined}
      data-notice-tone={tone}
      className={cn(textRole('body'), 'flex flex-wrap items-start gap-2', className)}
    >
      <span aria-hidden className="inline-flex h-5 shrink-0 items-center">
        <span className={cn('size-1.5 rounded-full', style.dot)} />
      </span>
      <div className="flex min-w-0 flex-[1_1_12rem] flex-col gap-1">
        {title != null ? (
          <p className="type-emphasis">
            {word}
            {title}
          </p>
        ) : (
          word
        )}
        {children != null ? <div>{children}</div> : null}
      </div>
      {action ? (
        <div className="phone:ms-6 phone:basis-[calc(100%-1.5rem)] phone:justify-start ms-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2 self-center">
          {action}
        </div>
      ) : null}
    </Root>
  );
}

function MutationFailureNotice({ notice, onRetry, recovery, className }: MutationFailure) {
  let action: ReactNode = recovery ?? null;
  if (action === null && notice.retryable && onRetry)
    action = (
      <Button type="button" variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    );
  else if (action === null && isPlanLimit(notice.code))
    action = <TextLink href={PLANS_HREF}>See plans</TextLink>;
  return (
    <MessageNoticeView
      tone="negative"
      className={className}
      action={withReference(action, notice.requestId)}
    >
      <span className="block">{notice.message}</span>
      {notice.code ? (
        <span className={textRole('caption', 'block')}>Support: code {notice.code}</span>
      ) : null}
    </MessageNoticeView>
  );
}

function ReadFailureNotice({ error, fallback, onRetry, pending, title, className }: ReadFailure) {
  const detail = humanizeApiError(error, fallback);
  const accessFailure = detail.status === 401 || detail.status === 403;
  const retryable = detail.retryable !== false && !accessFailure;
  const said = (detail.status ?? 0) >= 500 ? fallback : detail.message;
  const sentence = said.replace(/\.$/u, '') === title ? null : said;
  const action = retryable ? (
    <Button variant="secondary" onClick={onRetry} pending={pending} pendingLabel="Retrying…">
      Retry
    </Button>
  ) : null;
  let next: string | null = null;
  if (accessFailure) next = 'Check your workspace access, then try again.';
  else if (retryable && !sentence) next = 'Retry in a moment.';
  return (
    <MessageNoticeView
      tone="negative"
      title={title}
      action={withReference(action, detail.requestId)}
      className={className}
    >
      {sentence ? <p>{sentence}</p> : null}
      {next ? <p>{next}</p> : null}
    </MessageNoticeView>
  );
}

function withReference(action: ReactNode, requestId: string | undefined): ReactNode {
  if (!requestId) return action;
  return (
    <>
      {action}
      <Tooltip content={<span className="whitespace-nowrap">{requestId}</span>}>
        <CopyButton variant="quiet" value={requestId}>
          Copy reference
        </CopyButton>
      </Tooltip>
    </>
  );
}
