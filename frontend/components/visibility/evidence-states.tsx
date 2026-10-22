'use client';

import { Info, Inbox, RefreshCw, SearchX } from 'lucide-react';

import { ProjectLink } from '@/components/layout/scoped-link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardEyebrow, CardHeader, CardTitle } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { QueryState } from '@/components/ui/query-state';
import { Inline, Stack } from '@/components/ui/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { ICONS } from '@/lib/icons';

/**
 * Shared data-state presentations for the two evidence tabs: loading skeleton, retryable error, empty (no executions yet),
 * filtered-empty, and the truncation notice. Both `answer-evidence.tsx` and
 * `fanout-evidence.tsx` reuse these so their states stay consistent.
 */

import type { UseQueryResult } from '@tanstack/react-query';

import type { VisibilityEvidenceResponse } from '@/lib/api/types';

/** Props shared by the surfaces that render execution evidence. */
export type EvidenceTabProps = Readonly<{
  query: UseQueryResult<VisibilityEvidenceResponse, unknown>;
  isFiltered: boolean;
  onClearFilters?: () => void;
  limit: number;
}>;

export function EvidenceSkeleton({ title }: Readonly<{ title: string }>) {
  return (
    <Card aria-hidden>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Stack>
          <Skeleton shape="block" />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} shape="line" />
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}

export function EvidenceError({
  title,
  onRetry,
}: Readonly<{ title: string; onRetry: () => void }>) {
  return (
    <Card>
      <CardContent>
        <Stack gap="tight">
          <CardEyebrow>{title}</CardEyebrow>
          <QueryState
            kind="empty"
            headingLevel={3}
            icon={ICONS.warning}
            heading="Couldn't load this evidence"
            description="The request failed or timed out. Your filters are unchanged."
            action={
              <Button variant="primary" onClick={onRetry}>
                <Icon icon={RefreshCw} />
                Retry
              </Button>
            }
          />
        </Stack>
      </CardContent>
    </Card>
  );
}

export function EvidenceEmpty({
  title,
  heading,
  body,
}: Readonly<{ title: string; heading: string; body: string }>) {
  return (
    <Card>
      <CardContent>
        <Stack gap="tight">
          <CardEyebrow>{title}</CardEyebrow>
          <QueryState
            kind="empty"
            headingLevel={3}
            icon={Inbox}
            heading={heading}
            description={body}
            action={
              <Button asChild variant="ghost">
                <ProjectLink href="/runs">View Runs</ProjectLink>
              </Button>
            }
          />
        </Stack>
      </CardContent>
    </Card>
  );
}

export function EvidenceFilteredEmpty({
  title,
  body,
  onClear,
}: Readonly<{ title: string; body: string; onClear?: () => void }>) {
  return (
    <Card>
      <CardContent>
        <Stack gap="tight">
          <CardEyebrow>{title}</CardEyebrow>
          <QueryState
            kind="empty"
            headingLevel={3}
            icon={SearchX}
            heading="No results match these filters"
            description={body}
            action={
              onClear ? (
                <Button variant="ghost" onClick={onClear}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        </Stack>
      </CardContent>
    </Card>
  );
}

export function TruncationNotice({ limit }: Readonly<{ limit: number }>) {
  return (
    <Inline>
      <Icon icon={Info} />
      <span>Showing newest {limit} executions; refine filters to narrow results.</span>
    </Inline>
  );
}
