import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { agentQueries, type AgentCatalog } from '@/lib/api/agent';
import { useActiveWorkspaceId } from '@/lib/project/project-context';

const EMPTY: Omit<AgentCatalog, 'limits' | 'models'> = {
  skills: [],
  workflows: [],
  output_kinds: [],
};

export function useAgentCatalog() {
  const workspaceId = useActiveWorkspaceId() ?? '';
  const query = useQuery({ ...agentQueries.skills(workspaceId), enabled: Boolean(workspaceId) });
  const catalog = query.data ?? EMPTY;
  const limits = query.data?.limits ?? null;
  const models = query.data?.models ?? null;
  const { status, error, refetch, isFetching } = query;
  return useMemo(() => {
    const kinds = new Map(catalog.output_kinds.map((kind) => [kind.kind, kind]));
    const workflows = new Map(catalog.workflows.map((workflow) => [workflow.id, workflow]));
    const outputKind = (kind: string | null | undefined) => (kind ? kinds.get(kind) : undefined);
    return {
      ...catalog,
      limits,
      models,
      read: { status, error, refetch, isFetching },
      workflow: (id: string | null | undefined) => (id ? workflows.get(id) : undefined),
      outputKind,
      kindLabel: (kind: string | null | undefined) => outputKind(kind)?.label ?? 'Output',
    };
  }, [catalog, limits, models, status, error, refetch, isFetching]);
}
