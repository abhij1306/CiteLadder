'use client';

import { Info, Inbox, RefreshCw, SearchX } from 'lucide-react';

import { ProjectLink } from '@/components/layout/scoped-link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardEyebrow, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Stack } from '@/components/ui/layout';
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
      <CardContent className="grid gap-3">
        <Skeleton className="h-24 w-full" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-12" />
          </div>
        ))}
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
          <EmptyState
            headingLevel={3}
            icon={ICONS.warning}
            heading="Couldn't load this evidence"
            description="The request failed or timed out. Your filters are unchanged."
            action={
              <Button variant="primary" onClick={onRetry}>
                <RefreshCw className="size-3.5" aria-hidden />
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
          <EmptyState
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
          <EmptyState
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
    <div className="type-caption border-border-subtle flex items-center gap-2 border-t px-4 py-2">
      <Info className="size-4 shrink-0" aria-hidden />
      <span>Showing newest {limit} executions; refine filters to narrow results.</span>
    </div>
  );
}
