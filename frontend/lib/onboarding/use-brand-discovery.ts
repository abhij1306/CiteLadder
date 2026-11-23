import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { BrandDiscoveryCreateRequest } from '@citeladder/contracts/brand-discovery-requests';

import {
  brandDiscoveriesApi,
  brandDiscoveryMutations,
  brandDiscoveryQueries,
  type BrandDiscovery,
} from '@/lib/api/brand-discoveries';
import { isDiscoveryActive, pollDiscovery } from '@/lib/onboarding/discovery-activity';

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
  const startedFor = useRef<string | null>(null);
  const run = useMutation(brandDiscoveryMutations.run());
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
  const fingerprint = useMemo(() => JSON.stringify({ input, workspaceId }), [input, workspaceId]);
  const createdFor = useRef<string | null>(null);
  const [responseFor, setResponseFor] = useState<string | null>(null);
  const [restartedIn, setRestartedIn] = useState<{
    workspace: string | null;
    discovery: BrandDiscovery;
  } | null>(null);
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
  const discoveryId = started?.id ?? resumeId;
  const query = useQuery({
    ...brandDiscoveryQueries.detail(workspaceId, String(discoveryId)),
    enabled: Boolean(discoveryId),
    initialData: started,
    refetchInterval: (result) => pollDiscovery(result.state.data?.status),
  });
  const discovery = query.data ?? started;
  const active = isDiscoveryActive(discovery?.status);
  const execution = useDiscoveryExecution(discoveryId, active, workspaceId);
  const rerun = (onStarted?: () => void) => {
    if (!discoveryId || restart.isPending) return;
    onRestarted.current = onStarted ?? null;
    restart.mutate({ id: discoveryId, idempotencyKey: operationKey(), workspace: workspaceId });
  };
  const retry = () => {
    if (restart.error && restart.variables && !restart.isPending) {
      restart.mutate(restart.variables);
      return;
    }
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
