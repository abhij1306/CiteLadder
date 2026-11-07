'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { BrandDiscoveryCreateRequest } from '@citeladder/contracts/brand-discovery-requests';

import { brandDiscoveriesApi, type BrandDiscovery } from '@/lib/api/brand-discoveries';
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
  input: BrandDiscoveryCreateRequest | null,
  resumeId: string | null = null,
  workspaceId: string | null = null,
) {
  // The workspace is part of the operation's identity, not just its transport:
  // a discovery belongs to ONE workspace, so switching workspace must start a
  // new one rather than let `createdFor` suppress creation for the new one.
  const fingerprint = useMemo(() => JSON.stringify({ input, workspaceId }), [input, workspaceId]);
  const createdFor = useRef<string | null>(null);
  const [responseFor, setResponseFor] = useState<string | null>(null);
  // A run started again replaces the shown discovery until another one is
  // created, and only in the workspace that started it.
  const [restartedIn, setRestartedIn] = useState<{
    workspace: string | null;
    discovery: BrandDiscovery;
  } | null>(null);
  // Called once the new run exists, so a failed request leaves the old review intact.
  const onRestarted = useRef<(() => void) | null>(null);
  const restart = useMutation({
    mutationFn: ({
      id,
      idempotencyKey,
      workspace,
    }: {
      id: string;
      idempotencyKey: string;
      workspace: string | null;
    }) => brandDiscoveriesApi.rerun(id, idempotencyKey, { workspaceId: workspace }),
    onSuccess: (data, variables) => {
      setRestartedIn({ workspace: variables.workspace, discovery: data });
      onRestarted.current?.();
    },
  });
  const create = useMutation({
    // The fingerprint AND the workspace travel with the request, so the
    // response is matched against the operation that actually produced it —
    // not against whatever the hook happens to be rendering for now.
    mutationFn: ({
      payload,
      idempotencyKey,
      workspace,
    }: {
      payload: BrandDiscoveryCreateRequest;
      idempotencyKey: string;
      fingerprint: string;
      workspace: string | null;
    }) => brandDiscoveriesApi.create(payload, idempotencyKey, { workspaceId: workspace }),
    // A newly created discovery supersedes one that was run again.
    onMutate: () => setRestartedIn(null),
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

  const created = responseFor === fingerprint ? create.data : undefined;
  const restarted = restartedIn?.workspace === workspaceId ? restartedIn.discovery : undefined;
  const started = restarted ?? created;
  // A successful retry supersedes a resumed row. Until that response arrives,
  // the persisted resume id remains visible instead of blanking the timeline.
  const discoveryId = started?.id ?? resumeId;
  const query = useQuery({
    queryKey: brandDiscoveryKeys.detail(workspaceId, String(discoveryId)),
    queryFn: ({ signal }) => brandDiscoveriesApi.get(String(discoveryId), { signal, workspaceId }),
    enabled: Boolean(discoveryId),
    initialData: started,
    refetchInterval: (result) =>
      result.state.data?.status === 'queued' || result.state.data?.status === 'running'
        ? 1000
        : false,
  });
  const discovery = query.data ?? started;
  const active = discovery?.status === 'queued' || discovery?.status === 'running';
  const execution = useDiscoveryExecution(discoveryId, active, workspaceId);
  /** A new discovery from this one's input; a finished task is never reset. */
  const rerun = (onStarted?: () => void) => {
    if (!discoveryId || restart.isPending) return;
    onRestarted.current = onStarted ?? null;
    restart.mutate({ id: discoveryId, idempotencyKey: operationKey(), workspace: workspaceId });
  };
  const retry = () => {
    // A failed rerun request repeats with its own key, so it creates at most one discovery.
    if (restart.error && restart.variables && !restart.isPending) {
      restart.mutate(restart.variables);
      return;
    }
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
    isRunning: create.isPending || restart.isPending || active,
    error: restart.error ?? create.error ?? query.error ?? execution.error,
    retry,
    rerun,
  };
}
