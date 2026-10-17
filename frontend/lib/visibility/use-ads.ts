'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import type { VisibilityAdsResponse } from '@citeladder/contracts/visibility-ads';

import { retainPreviousDataForScope } from '@/lib/api/query-client';
import { queryKeys } from '@/lib/api/query-keys';
import { visibilityApi } from '@/lib/api/visibility';
import type { SourceFilters } from '@/components/visibility/source-rows';
import {
  selectionEnabled,
  selectionParams,
  type SourceQueries,
} from '@/lib/visibility/use-source-analysis';

/** The first page's summary with every loaded page of creatives behind it. */
export function mergedAdPages(
  pages: readonly [VisibilityAdsResponse, ...VisibilityAdsResponse[]],
): VisibilityAdsResponse {
  const [first] = pages;
  return {
    ...first,
    creatives: {
      ...first.creatives,
      items: pages.flatMap((page) => page.creatives.items),
      next_cursor: pages.at(-1)?.creatives.next_cursor ?? null,
    },
  };
}

/**
 * The Ads tab's read: the same run / engine / prompt-type selection as
 * Sources, with creatives paged by the read's cursor. A range with no runs
 * reads nothing rather than keeping the previous selection.
 */
export function useAds(filters: Pick<SourceFilters, 'engine' | 'cohort'>, queries: SourceQueries) {
  const params = selectionParams(filters, queries);
  const projectId = queries.projectId ?? '';
  const enabled = selectionEnabled(queries);
  const query = useInfiniteQuery({
    queryKey: queryKeys.visibility.ads(projectId, params),
    queryFn: ({ signal, pageParam }) =>
      visibilityApi.getAds(
        projectId,
        { ...params, cursor: pageParam },
        { signal, workspaceId: queries.workspaceId },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.creatives.next_cursor ?? undefined,
    enabled,
    placeholderData: enabled
      ? (data, previous) => retainPreviousDataForScope(projectId, data, previous)
      : undefined,
  });
  return { query, enabled };
}
