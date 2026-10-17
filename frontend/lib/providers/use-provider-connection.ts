'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { providersApi } from '@/lib/api/providers';
import { humanizeApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import type { ProviderConnection } from '@/lib/api/types';
import { useActiveWorkspaceId } from '@/lib/project/project-context';
import {
  connectionForTransport,
  isConfigured,
  mergeRoutePayload,
  type ProviderGroup,
} from './catalog';

/** Result of an inline "Test connection" run. */
export type ConnectionTestState = { status: 'ok' | 'failed'; message: string } | null;

/** Shared human-readable mutation error. */
export function errorMessage(error: unknown): string {
  return humanizeApiError(error).message;
}

/**
 * Shared BYOK connection state machine for one provider credential, rendered
 * by every `ProviderRow` (Settings and the launch dialog's inline setup).
 *
 * Owns the write-only credential input state (never pre-filled — the stored
 * secret is never on the wire), the save mutation (create or rotate the
 * transport's connection and route EVERY engine it measures, so one DataForSEO
 * login serves all its surfaces), and the "Test connection" mutation.
 *
 * SAVING ALWAYS PROBES. Storing a key does not make it executable: admission
 * only resolves a BYOK route whose LATEST probe succeeded, so a key that was
 * saved and never tested is invisible to the planner and a launch refuses with
 * `execution_credentials_unavailable`. Settings hid that because the row stays
 * on screen and users click "Test connection" themselves; the launch flow moves
 * on after a save, so the probe never happened and the very next launch
 * failed. Folding the probe into the save makes "connected" mean the same
 * thing — verified — on every surface.
 *
 * A save clears the key and invalidates the shared `providers.connections()`
 * query either way; `onSaved` fires ONLY on a verified save, so a host
 * collapses on success and stays open showing the failure.
 */
export function useProviderConnection({
  group,
  connections,
  onSaved,
}: Readonly<{
  group: ProviderGroup;
  connections: ProviderConnection[];
  onSaved?: () => void;
}>) {
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();

  const transport = group.transport;
  // Two credential SHAPES, one state machine. Bearer transports fill
  // `apiKey`; DataForSEO authenticates with an HTTP Basic pair and fills
  // `apiLogin` + `apiPassword`. All three stay write-only and are never
  // pre-filled — the stored secret is never on the wire.
  const credentialShape = group.credential_shape;
  const [apiKey, setApiKey] = useState('');
  const [apiLogin, setApiLogin] = useState('');
  const [apiPassword, setApiPassword] = useState('');
  const [testResult, setTestResult] = useState<ConnectionTestState>(null);

  // Whether the user has entered a COMPLETE credential. A half-entered pair
  // is not input: sending one half would rotate the stored credential into a
  // state nobody typed.
  const hasCredentialInput =
    credentialShape === 'basic' ? Boolean(apiLogin.trim() && apiPassword) : Boolean(apiKey);

  // ...and a half-entered pair is not "nothing" either. On an already
  // configured connection the save button is enabled (you may be updating
  // only the routes), so without this a half-typed pair would be quietly
  // dropped and the save would report success — telling the user their
  // credentials were updated when the field they typed into was ignored.
  const hasPartialCredentialInput =
    credentialShape === 'basic' && Boolean(apiLogin.trim()) !== Boolean(apiPassword);

  const clearCredentialInput = () => {
    setApiKey('');
    setApiLogin('');
    setApiPassword('');
  };

  /** The write-only credential fields for this shape, or nothing to rotate. */
  const credentialPayload = () =>
    credentialShape === 'basic'
      ? { api_login: apiLogin.trim(), api_password: apiPassword }
      : { api_key: apiKey };

  const connection = connectionForTransport(connections, transport);

  const invalidateProviderReads = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.providers.allConnections() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.providers.allStates() }),
    ]);
  const configured = isConfigured(connection);

  /**
   * Probe one connection and fold the outcome into the alert model. Returns
   * the state so the save path can decide whether the connect flow is done.
   */
  const probe = async (connectionId: string): Promise<ConnectionTestState> => {
    const result = await providersApi.testConnection(connectionId, { workspaceId });
    const state: ConnectionTestState =
      result.status === 'ok'
        ? { status: 'ok', message: `Connection succeeded (${result.transport_model || 'model'}).` }
        : { status: 'failed', message: result.detail || 'Connection failed.' };
    setTestResult(state);
    return state;
  };

  const saveMutation = useMutation({
    onMutate: () => setTestResult(null),
    mutationFn: async () => {
      // A group only holds connectable engines; an empty one would store a
      // credential with nothing to measure.
      if (!group.engines.length) throw new Error('No route available.');
      if (hasPartialCredentialInput) {
        throw new Error('Enter both the API login and the API password.');
      }
      // A new connection needs a complete credential; creating one from empty
      // fields would store a connection nobody can use.
      if (!connection && !hasCredentialInput) {
        throw new Error('Enter the credentials before saving.');
      }
      const routes = mergeRoutePayload(
        connection,
        group.engines.map((engine) => engine.logical_engine),
      );
      const credential = hasCredentialInput ? credentialPayload() : {};
      const saved = connection
        ? await providersApi.updateConnection(
            connection.id,
            { ...credential, routes },
            {
              workspaceId,
            },
          )
        : await providersApi.createConnection(
            { transport_provider: transport, ...credentialPayload(), routes },
            { workspaceId },
          );
      // The key IS stored at this point, so a probe fault is reported as a
      // failed test rather than a failed save — telling the user their key
      // did not save would be wrong, and would send them to rotate a key
      // that is already there.
      let verified: ConnectionTestState;
      try {
        verified = await probe(saved.id);
      } catch (error) {
        verified = { status: 'failed', message: errorMessage(error) };
        setTestResult(verified);
      }
      return { saved, verified };
    },
    onSuccess: async ({ verified }) => {
      clearCredentialInput();
      await invalidateProviderReads();
      if (verified?.status === 'ok') onSaved?.();
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      if (!connection) throw new Error('Save a key before testing.');
      return probe(connection.id);
    },
    // The probe denormalizes its outcome onto the connection, and that outcome
    // is what gates launching and the status badge — so both reads are stale.
    onSuccess: () => invalidateProviderReads(),
    onError: (error) => setTestResult({ status: 'failed', message: errorMessage(error) }),
  });

  const busy = saveMutation.isPending || testMutation.isPending;

  return {
    transport,
    connection,
    configured,
    credentialShape,
    hasPartialCredentialInput,
    apiKey,
    setApiKey,
    apiLogin,
    setApiLogin,
    apiPassword,
    setApiPassword,
    hasCredentialInput,
    testResult,
    saveMutation,
    testMutation,
    busy,
  };
}
