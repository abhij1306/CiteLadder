'use client';

import { Info, Inbox, RefreshCw, SearchX } from 'lucide-react';
import type { UseQueryResult } from '@tanstack/react-query';

import { ProjectLink } from '@/components/layout/scoped-link';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { QueryState } from '@/components/ui/query-state';
import { Inline } from '@/components/ui/layout';
import { ICONS } from '@/lib/icons';
import type { VisibilityEvidenceResponse } from '@/lib/api/types';

/**
 * Shared data-state presentations for the evidence tabs (design.md states
 * gallery): loading, retryable error, empty (no executions yet),
 * filtered-empty, and the truncation notice.
 *
 * Each is one `QueryState` at the shared footprint, with no card or eyebrow
 * of its own: the tab row already names the view, so a title over the state
 * only repeated it and grew the box (2026-11-03 app review).
 */

/** Props shared by the surfaces that render execution evidence. */
export type EvidenceTabProps = Readonly<{
  query: UseQueryResult<VisibilityEvidenceResponse, unknown>;
  isFiltered: boolean;
  onClearFilters?: () => void;
  limit: number;
}>;

export function EvidenceSkeleton() {
  return <QueryState kind="loading" label="Loading evidence…" />;
}

export function EvidenceError({ onRetry }: Readonly<{ onRetry: () => void }>) {
  return (
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
  );
}

export function EvidenceEmpty({ heading, body }: Readonly<{ heading: string; body: string }>) {
  return (
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
  );
}

export function EvidenceFilteredEmpty({
  body,
  onClear,
}: Readonly<{ body: string; onClear?: () => void }>) {
  return (
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
