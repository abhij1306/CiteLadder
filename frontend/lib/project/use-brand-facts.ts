import { useQuery } from '@tanstack/react-query';

import { projectQueries } from '@/lib/api/projects';
import { useProjectScope } from '@/lib/project/active-project-scope';

export function useBrandFacts() {
  return useQuery(projectQueries.brandFacts(useProjectScope()));
}
