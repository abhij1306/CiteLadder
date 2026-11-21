import { useInfiniteQuery } from '@tanstack/react-query';
import type { VisibilityAdsResponse } from '@citeladder/contracts/visibility-ads';

import { retainPreviousDataForScope } from '@/lib/api/query-client';
import { visibilityQueries } from '@/lib/api/visibility-queries';
import type { SourceFilters } from '@/components/visibility/source-rows';
import {
  selectionEnabled,
  topicSelectionParams,
  type SourceQueries,
} from '@/lib/visibility/use-source-analysis';

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

export function useAds(filters: Pick<SourceFilters, 'engine' | 'cohort'>, queries: SourceQueries) {
  const params = topicSelectionParams(filters, queries);
  const { projectId } = queries;
  const enabled = selectionEnabled(queries);
  const query = useInfiniteQuery({
    ...visibilityQueries.ads({ workspaceId: queries.workspaceId, projectId }, params),
    enabled,
    placeholderData: enabled
      ? (data, previous) => retainPreviousDataForScope(projectId, data, previous)
      : undefined,
  });
  return query;
}
