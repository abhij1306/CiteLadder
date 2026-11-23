import type { ReactNode } from 'react';

import { Inline, Stack } from '@/components/ui/layout';
import { Notice, readErrorProps, type RetryableRead } from '@/components/ui/notice';
import type { LoadingShape } from '@/components/ui/skeleton-block';
import { StateBlock } from '@/components/ui/state-block';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { httpErrorStatus } from '@/lib/api/errors';

export function isForbidden(error: unknown): boolean {
  return httpErrorStatus(error) === 403;
}

function isGone(error: unknown): boolean {
  return isForbidden(error) || httpErrorStatus(error) === 404;
}

export function ViewFrame({
  title,
  href,
  children,
}: Readonly<{ title: string; href: string; children: ReactNode }>) {
  return (
    <Stack as="figure" gap="compact" aria-label={title} className="min-w-0">
      {children}
      <Inline as="figcaption" className="flex-wrap justify-between">
        <span className={textRole('caption')}>{title}</span>
        <TextLink href={href}>Open in app</TextLink>
      </Inline>
    </Stack>
  );
}

export function ViewUnavailable() {
  return (
    <Notice tone="info">
      This view is unavailable: its record was removed or you can no longer read it.
    </Notice>
  );
}

export function ViewRead<T>({
  query,
  subject,
  shape,
  children,
}: Readonly<{
  query: RetryableRead & { data: T | undefined; isPending: boolean };
  subject: string;
  shape: LoadingShape;
  children: (data: T) => ReactNode;
}>) {
  if (isGone(query.error)) return <ViewUnavailable />;
  if (query.error)
    return (
      <Notice
        kind="read"
        {...readErrorProps(query)}
        title={`Couldn't load ${subject}`}
        fallback="The request failed or timed out."
      />
    );
  if (query.isPending || query.data === undefined)
    return <StateBlock kind="loading" label={`Loading ${subject}…`} shape={shape} />;
  return children(query.data);
}
