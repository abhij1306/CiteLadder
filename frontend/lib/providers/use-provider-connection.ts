import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { providersApi, refreshProviderReads } from '@/lib/api/providers';
import { humanizeApiError } from '@/lib/api/errors';
import { executionFailureReason } from '@/lib/runs/status';
import type { ProviderConnection } from '@citeladder/contracts';
import { useActiveWorkspaceId } from '@/lib/project/project-context';
import {
  connectionForTransport,
  isConfigured,
  mergeRoutePayload,
  type ProviderGroup,
} from './catalog';

export type ConnectionTestState = { status: 'ok' | 'failed'; message: string } | null;

function errorMessage(error: unknown): string {
  return humanizeApiError(error).message;
}

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
  const credentialShape = group.credential_shape;
  const [apiKey, setApiKey] = useState('');
  const [apiLogin, setApiLogin] = useState('');
  const [apiPassword, setApiPassword] = useState('');
  const [testResult, setTestResult] = useState<ConnectionTestState>(null);

  const hasCredentialInput =
    credentialShape === 'basic' ? Boolean(apiLogin.trim() && apiPassword) : Boolean(apiKey);

  const hasPartialCredentialInput =
    credentialShape === 'basic' && Boolean(apiLogin.trim()) !== Boolean(apiPassword);

  const clearCredentialInput = () => {
    setApiKey('');
    setApiLogin('');
    setApiPassword('');
  };

  const credentialPayload = () =>
    credentialShape === 'basic'
      ? { api_login: apiLogin.trim(), api_password: apiPassword }
      : { api_key: apiKey };

  const connection = connectionForTransport(connections, transport);

  const configured = isConfigured(connection);

  const probe = async (connectionId: string): Promise<ConnectionTestState> => {
    const result = await providersApi.testConnection(connectionId, { workspaceId });
    const state: ConnectionTestState =
      result.status === 'ok'
        ? { status: 'ok', message: 'Connection succeeded.' }
        : {
            status: 'failed',
            message: executionFailureReason(result.error_code, 'Connection failed.'),
          };
    setTestResult(state);
    return state;
  };

  const saveMutation = useMutation({
    onMutate: () => setTestResult(null),
    mutationFn: async () => {
      if (!group.engines.length) throw new Error('No route available.');
      if (hasPartialCredentialInput) {
        throw new Error('Enter both the API login and the API password.');
      }
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
      await refreshProviderReads(queryClient);
      if (verified?.status === 'ok') onSaved?.();
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      if (!connection) throw new Error('Save a key before testing.');
      return probe(connection.id);
    },
    onSuccess: () => refreshProviderReads(queryClient),
    onError: (error) => setTestResult({ status: 'failed', message: errorMessage(error) }),
  });

  const removeMutation = useMutation({
    onMutate: () => setTestResult(null),
    mutationFn: async () => {
      if (!connection) throw new Error('No saved key to remove.');
      await providersApi.deleteConnection(connection.id, { workspaceId });
    },
    onSuccess: async () => {
      clearCredentialInput();
      await refreshProviderReads(queryClient);
      onSaved?.();
    },
    onError: (error) => setTestResult({ status: 'failed', message: errorMessage(error) }),
  });

  const busy = saveMutation.isPending || testMutation.isPending || removeMutation.isPending;

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
    removeMutation,
    busy,
  };
}
