import { useMutation } from '@tanstack/react-query';
import { aiTrafficMutations } from '@/lib/api/ai-traffic';

export function useGcpPullActions(projectId: string, workspaceId: string) {
  const scope = { workspaceId, projectId };
  const verify = useMutation(aiTrafficMutations.verifySource(scope));
  const confirmFilter = useMutation(aiTrafficMutations.confirmSinkFilter(scope));
  return { verify, confirmFilter };
}
