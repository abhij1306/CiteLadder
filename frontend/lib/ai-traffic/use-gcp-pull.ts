import { useMutation, useQueryClient } from '@tanstack/react-query';
import { aiTrafficApi } from '@/lib/api/ai-traffic';
import { queryKeys } from '@/lib/api/query-keys';

/** Commands on a Google Cloud pull source: check its subscription, confirm a filter update. */
export function useGcpPullActions(projectId: string, workspaceId: string) {
  const client = useQueryClient();
  const options = { workspaceId };
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.aiTraffic.all });
  const verify = useMutation({
    mutationFn: (sourceId: string) => aiTrafficApi.verifySource(projectId, sourceId, options),
    onSuccess: refresh,
  });
  const confirmFilter = useMutation({
    mutationFn: (sourceId: string) => aiTrafficApi.confirmSinkFilter(projectId, sourceId, options),
    onSuccess: refresh,
  });
  return { verify, confirmFilter };
}
