import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { visibilityQueries } from '@/lib/api/visibility-queries';
import type { ProjectRequestScope } from '@/lib/project/request-scope';

import type { PromptMeasurement } from './prompt-table';

/**
 * The latest default-market run's prompt rows: one query shared by the prompt
 * table and Overview, so both read the same cache entry the same way.
 */
export function useLatestPromptMetrics(scope: ProjectRequestScope) {
  return useQuery({
    ...visibilityQueries.prompts(scope),
    enabled: scope.enabled,
  });
}

/**
 * What the project's latest run measured for each prompt.
 *
 * Keyed by the SOURCE prompt id, because that is what this table's rows are.
 * A prompt added since the last run simply has no entry, which reads as
 * "Not measured" rather than a fabricated zero.
 *
 * Undefined until the first read settles: whether a run exists decides the
 * table's columns, so the table waits for it instead of drawing without the
 * measured columns and then squeezing four in beside rows already on screen.
 */
export function useLatestPromptMeasurements(
  scope: ProjectRequestScope,
): ReadonlyMap<string, PromptMeasurement> | undefined {
  const result = useLatestPromptMetrics(scope);
  return useMemo(() => {
    if (result.isLoading) return undefined;
    const map = new Map<string, PromptMeasurement>();
    // A failed read is not a measured absence. Returning an empty map drops the
    // columns entirely, which says "no run yet" rather than "every prompt is
    // unmeasured" — the honest reading when we could not load the figures.
    if (result.isError) return map;
    for (const row of result.data ?? []) {
      if (!row.prompt_id) continue;
      map.set(row.prompt_id, {
        visibilityRate: row.visibility_rate ?? null,
        ownedCitationRate: row.owned_citation_rate ?? null,
        change: row.visibility_delta ?? null,
        position: row.avg_position ?? null,
      });
    }
    return map;
  }, [result.data, result.isError, result.isLoading]);
}
