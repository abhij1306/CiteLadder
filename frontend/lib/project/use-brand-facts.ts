import { useQuery } from '@tanstack/react-query';

import { projectQueries } from '@/lib/api/projects';
import { useProjectScope } from '@/lib/project/active-project-scope';

/**
 * The project's brand facts and whether the workspace is in the fact-checking
 * pilot. One cache entry serves the Context panel and the Accuracy tab gate.
 */
export function useBrandFacts() {
  return useQuery(projectQueries.brandFacts(useProjectScope()));
}
