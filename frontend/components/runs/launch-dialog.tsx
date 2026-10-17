'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { promptsApi } from '@/lib/api/prompts';
import { providersApi } from '@/lib/api/providers';
import { queryKeys } from '@/lib/api/query-keys';
import { runsApi } from '@/lib/api/runs';
import type { Audit, LogicalEngine, PromptSet } from '@/lib/api/types';
import { ENGINE_ORDER, isConfigured, isVerified, isConsumerEngine } from '@/lib/providers/catalog';
import { useActiveWorkspaceId } from '@/lib/project/project-context';
import { useProjectMarkets } from '@/lib/project/use-project-markets';
import {
  auditablePrompts,
  buildLaunchPayload,
  canLaunch,
  DEFAULT_REPETITIONS,
  promptBatches,
} from '@/lib/runs/launch';

import { LaunchDialogView } from './launch-dialog-view';

function availableEngines(
  connections: Awaited<ReturnType<typeof providersApi.listConnections>> | undefined,
) {
  const verified = new Set<LogicalEngine>();
  const stored = new Set<LogicalEngine>();
  for (const connection of connections ?? []) {
    if (!connection.active) continue;
    if (!isConfigured(connection)) continue;
    const target = isVerified(connection) ? verified : stored;
    for (const route of connection.routes ?? []) {
      if (route.active !== false) target.add(route.logical_engine);
    }
  }
  return {
    configuredEngines: ENGINE_ORDER.filter((engine) => verified.has(engine)),
    unverifiedEngines: ENGINE_ORDER.filter((engine) => stored.has(engine) && !verified.has(engine)),
  };
}

/** The engines a launch can measure: the workspace's own provider routes. */
function useLaunchEngines(open: boolean, workspaceId: string | null) {
  const connectionsQuery = useQuery({
    queryKey: queryKeys.providers.connections(workspaceId ?? 'unresolved'),
    queryFn: ({ signal }) => providersApi.listConnections({ signal, workspaceId }),
    enabled: open && workspaceId !== null,
  });
  const engines = useMemo(() => availableEngines(connectionsQuery.data), [connectionsQuery.data]);
  return { ...engines, enginesReady: connectionsQuery.isSuccess };
}

function fixedPromptSelection(
  fixedPromptSetId: string | undefined,
  fixedPromptIds: string[] | undefined,
  promptSelectionLabel: string | undefined,
) {
  const count = fixedPromptIds?.length ?? 0;
  const noun = count === 1 ? 'prompt' : 'prompts';
  return {
    locked: count > 0 || Boolean(fixedPromptSetId),
    label: promptSelectionLabel ?? (count ? `${count} selected ${noun}` : undefined),
  };
}

function batchSelection(
  promptSets: PromptSet[] | undefined,
  selectedPromptSetId: string | null,
  fixedPromptSetId: string | undefined,
  fixedPromptIds: string[] | undefined,
  batchIndex: number | null,
  locked: boolean,
) {
  const effectivePromptSetId =
    fixedPromptSetId ?? selectedPromptSetId ?? promptSets?.[0]?.id ?? null;
  const set = promptSets?.find((item) => item.id === effectivePromptSetId);
  const batches = locked ? [] : promptBatches(auditablePrompts(set));
  const selectedBatch = batchIndex === null ? undefined : batches[batchIndex];
  const selectedBatchMissing = batchIndex !== null && selectedBatch === undefined;
  return {
    effectivePromptSetId,
    batches,
    payloadPromptSetId: selectedBatchMissing ? null : effectivePromptSetId,
    promptIds: fixedPromptIds ?? selectedBatch?.map((prompt) => prompt.id),
  };
}

/** Launch controller: queries, mutations, and form selection stay here; UI is in the view. */
export function LaunchDialog({
  open,
  onOpenChange,
  projectId,
  onLaunched,
  fixedPromptSetId,
  fixedPromptIds,
  promptSelectionLabel,
  auditScope = 'brand',
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onLaunched?: (audit: Audit) => void;
  fixedPromptSetId?: string;
  fixedPromptIds?: string[];
  promptSelectionLabel?: string;
  auditScope?: 'brand' | 'commerce';
}>) {
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const promptSetsQuery = useQuery({
    queryKey: queryKeys.prompts.sets(projectId),
    queryFn: ({ signal }) => promptsApi.listPromptSets(projectId, { signal, workspaceId }),
    enabled: open && workspaceId !== null,
  });
  const { configuredEngines, unverifiedEngines, enginesReady } = useLaunchEngines(
    open,
    workspaceId,
  );
  // One contract, derived from the same values the payload is built from:
  // `fixedPromptIds` wins in `buildLaunchPayload`, so it must also lock the
  // field and name the selection. Locking only on `fixedPromptSetId` left the
  // commerce caller showing an editable prompt-set select whose value the
  // payload ignored.
  const fixedSelection = fixedPromptSelection(
    fixedPromptSetId,
    fixedPromptIds,
    promptSelectionLabel,
  );
  const [promptSetId, setPromptSetId] = useState<string | null>(null);
  const [engines, setEngines] = useState<LogicalEngine[]>([]);
  const initialized = useRef(false);
  useEffect(() => {
    if (!open) {
      initialized.current = false;
      return;
    }
    if (!initialized.current && enginesReady) {
      initialized.current = true;
      setEngines(configuredEngines.filter(isConsumerEngine));
    }
  }, [open, enginesReady, configuredEngines]);
  const [repetitions, setRepetitions] = useState(DEFAULT_REPETITIONS);
  const markets = useProjectMarkets(projectId, workspaceId, open);
  // The default market alone until the reader picks more.
  const [marketIds, setMarketIds] = useState<(string | null)[]>([null]);
  // The inline provider setup: closed, open on no particular provider, or
  // open on the provider that measures the engine the user clicked.
  const [connecting, setConnecting] = useState<LogicalEngine | 'any' | null>(null);
  // Closed here, whoever closed it (the user, or the owner after a launch), so
  // the next open never lands on a stale setup panel.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setConnecting(null);
  }
  // `null` means the whole set. A caller that already fixed the prompts owns
  // the selection outright, so batching is not offered there.
  const [batchIndex, setBatchIndex] = useState<number | null>(null);
  const promptSelection = useMemo(
    () =>
      batchSelection(
        promptSetsQuery.data,
        promptSetId,
        fixedPromptSetId,
        fixedPromptIds,
        batchIndex,
        fixedSelection.locked,
      ),
    [
      promptSetsQuery.data,
      promptSetId,
      fixedPromptSetId,
      fixedPromptIds,
      batchIndex,
      fixedSelection.locked,
    ],
  );
  // An engine whose route went inactive leaves the picker and the payload
  // together; both render from this one reconciled selection.
  const selectedEngines = useMemo(
    () => engines.filter((engine) => configuredEngines.includes(engine)),
    [engines, configuredEngines],
  );
  const selection = {
    projectId,
    promptSetId: promptSelection.payloadPromptSetId,
    promptIds: promptSelection.promptIds,
    engines: selectedEngines,
    marketIds,
    repetitions,
    auditScope,
  };
  const ready = workspaceId !== null && canLaunch(selection);
  const estimateQuery = useQuery({
    queryKey: ['audit-estimate', selection],
    queryFn: () => runsApi.estimateAudit(buildLaunchPayload(selection), { workspaceId }),
    enabled: open && ready && workspaceId !== null,
  });
  const reset = () => {
    setEngines([]);
    setPromptSetId(null);
    setRepetitions(DEFAULT_REPETITIONS);
    setMarketIds([null]);
    setBatchIndex(null);
  };
  const launchMutation = useMutation({
    mutationFn: () => {
      if (!workspaceId) throw new Error('Workspace is not available.');
      return runsApi.launchAudit(buildLaunchPayload(selection), { workspaceId });
    },
    onSuccess: async (audits) => {
      for (const audit of audits) queryClient.setQueryData(queryKeys.runs.detail(audit.id), audit);
      await queryClient.invalidateQueries({ queryKey: queryKeys.runs.all });
      onOpenChange(false);
      reset();
      if (audits[0]) onLaunched?.(audits[0]);
    },
  });
  const launchNotice = launchMutation.isError
    ? mutationNoticeForError(launchMutation.error, { action: 'launch the audit' })
    : null;

  return (
    <LaunchDialogView
      open={open}
      onOpenChange={onOpenChange}
      promptSets={promptSetsQuery.data ?? []}
      promptSetsLoading={promptSetsQuery.isLoading}
      configuredEngines={configuredEngines}
      unverifiedEngines={unverifiedEngines}
      promptSetId={promptSelection.effectivePromptSetId}
      setPromptSetId={(id) => {
        // A batch index means nothing against a different set's prompts.
        setPromptSetId(id);
        setBatchIndex(null);
      }}
      batches={promptSelection.batches}
      batchIndex={batchIndex}
      setBatchIndex={setBatchIndex}
      engines={selectedEngines}
      setEngines={(update) =>
        setEngines(typeof update === 'function' ? update(selectedEngines) : update)
      }
      repetitions={repetitions}
      setRepetitions={setRepetitions}
      markets={markets}
      marketIds={marketIds}
      setMarketIds={setMarketIds}
      estimate={estimateQuery.data}
      launchPending={launchMutation.isPending}
      launchNotice={launchNotice}
      onLaunch={() => launchMutation.mutate()}
      connecting={connecting}
      setConnecting={setConnecting}
      promptSetLocked={fixedSelection.locked}
      promptSelectionLabel={fixedSelection.label}
      selectionReady={ready}
    />
  );
}
