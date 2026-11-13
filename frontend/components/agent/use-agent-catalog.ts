import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { agentQueries, type AgentCatalog } from '@/lib/api/agent';
import { useActiveWorkspaceId } from '@/lib/project/project-context';

const EMPTY: Omit<AgentCatalog, 'limits'> = {
  skills: [],
  workflow_groups: [],
  workflows: [],
  output_kinds: [],
};

/**
 * The server-owned skill and workflow catalog. Workflows, deliverable labels,
 * refinements and next steps all come from here, so a new deliverable type
 * needs no browser change.
 */
export function useAgentCatalog() {
  const workspaceId = useActiveWorkspaceId() ?? '';
  const query = useQuery({ ...agentQueries.skills(workspaceId), enabled: Boolean(workspaceId) });
  const catalog = query.data ?? EMPTY;
  // Unknown until the catalog loads: no bound is assumed in the meantime.
  const limits = query.data?.limits ?? null;
  const { status, error, refetch, isFetching } = query;
  return useMemo(() => {
    const kinds = new Map(catalog.output_kinds.map((kind) => [kind.kind, kind]));
    const workflows = new Map(catalog.workflows.map((workflow) => [workflow.id, workflow]));
    const outputKind = (kind: string | null | undefined) => (kind ? kinds.get(kind) : undefined);
    return {
      ...catalog,
      /** Bounds the API enforces on a composed message; null until the catalog loads. */
      limits,
      /**
       * The catalog read itself. Until it succeeds the lists above are empty
       * because nothing was read, not because the plan has no skills or
       * workflows, so a failure is reported where the catalog is offered.
       */
      read: { status, error, refetch, isFetching },
      workflow: (id: string | null | undefined) => (id ? workflows.get(id) : undefined),
      outputKind,
      kindLabel: (kind: string | null | undefined) => outputKind(kind)?.label ?? 'Output',
    };
  }, [catalog, limits, status, error, refetch, isFetching]);
}
