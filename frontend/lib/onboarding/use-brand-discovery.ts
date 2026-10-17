'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { brandDiscoveriesApi, type BrandDiscoveryInput } from '@/lib/api/brand-discoveries';
import { brandDiscoveryKeys } from '@/lib/api/query-keys/brand-discovery';

let fallbackOperationSequence = 0;

function operationKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  fallbackOperationSequence += 1;
  return `discovery-${Date.now()}-${fallbackOperationSequence}`;
}

function useDiscoveryExecution(
  discoveryId: string | null,
  active: boolean,
  workspaceId: string | null,
) {
  const queryClient = useQueryClient();
  const startedFor = useRef<string | null>(null);
  const run = useMutation({
    mutationFn: ({ id, workspace }: { id: string; workspace: string | null }) =>
      brandDiscoveriesApi.run(id, { workspaceId: workspace }),
    onSettled: (_data, _error, { id, workspace }) => {
      void queryClient.invalidateQueries({ queryKey: brandDiscoveryKeys.detail(workspace, id) });
    },
  });
  const executionKey = discoveryId ? JSON.stringify([workspaceId, discoveryId]) : null;
  useEffect(() => {
    if (!discoveryId || !active || startedFor.current === executionKey) return;
    startedFor.current = executionKey;
    run.mutate({ id: discoveryId, workspace: workspaceId });
  }, [active, discoveryId, executionKey, run, workspaceId]);
  const error =
    active && run.variables?.id === discoveryId && run.variables.workspace === workspaceId
      ? run.error
      : null;
  return {
    error,
    retry: () => {
      if (discoveryId && error && !run.isPending)
        run.mutate({ id: discoveryId, workspace: workspaceId });
    },
  };
}

export function useBrandDiscovery(
  input: BrandDiscoveryInput | null,
  resumeId: string | null = null,
  workspaceId: string | null = null,
) {
  // The workspace is part of the operation's identity, not just its transport:
  // a discovery belongs to ONE workspace, so switching workspace must start a
  // new one rather than let `createdFor` suppress creation for the new one.
  const fingerprint = useMemo(() => JSON.stringify({ input, workspaceId }), [input, workspaceId]);
  const createdFor = useRef<string | null>(null);
  const [responseFor, setResponseFor] = useState<string | null>(null);
  const create = useMutation({
    // The fingerprint AND the workspace travel with the request, so the
    // response is matched against the operation that actually produced it —
    // not against whatever the hook happens to be rendering for now.
    mutationFn: ({
      payload,
      idempotencyKey,
      workspace,
    }: {
      payload: BrandDiscoveryInput;
      idempotencyKey: string;
      fingerprint: string;
      workspace: string | null;
    }) => brandDiscoveriesApi.create(payload, idempotencyKey, { workspaceId: workspace }),
    onSuccess: (_data, variables) => {
      setResponseFor(variables.fingerprint);
    },
  });

  useEffect(() => {
    if (resumeId || !input || createdFor.current === fingerprint) return;
    createdFor.current = fingerprint;
    create.mutate({
      payload: input,
      idempotencyKey: operationKey(),
      fingerprint,
      workspace: workspaceId,
    });
  }, [create, fingerprint, input, resumeId, workspaceId]);

  const createdDiscoveryId = responseFor === fingerprint ? create.data?.id : undefined;
  // A successful retry supersedes a resumed row. Until that response arrives,
  // the persisted resume id remains visible instead of blanking the timeline.
  const discoveryId = createdDiscoveryId ?? resumeId;
  const query = useQuery({
    queryKey: brandDiscoveryKeys.detail(workspaceId, String(discoveryId)),
    queryFn: ({ signal }) => brandDiscoveriesApi.get(String(discoveryId), { signal, workspaceId }),
    enabled: Boolean(discoveryId),
    initialData: !createdDiscoveryId ? undefined : create.data,
    refetchInterval: (result) =>
      result.state.data?.status === 'queued' || result.state.data?.status === 'running'
        ? 1000
        : false,
  });
  const discovery = query.data ?? (createdDiscoveryId ? create.data : undefined);
  const active = discovery?.status === 'queued' || discovery?.status === 'running';
  const execution = useDiscoveryExecution(discoveryId, active, workspaceId);
  const retry = () => {
    // A failed progress read resumes the existing operation, even before its
    // saved input has loaded. Creating another discovery would duplicate work.
    if (discoveryId && !create.error) {
      execution.retry();
      void query.refetch();
      return;
    }
    if (!input || create.isPending) return;
    createdFor.current = fingerprint;
    create.mutate({
      payload: input,
      idempotencyKey: operationKey(),
      fingerprint,
      workspace: workspaceId,
    });
  };
  return {
    discovery,
    isRunning: create.isPending || active,
    error: create.error ?? query.error ?? execution.error,
    retry,
  };
}
