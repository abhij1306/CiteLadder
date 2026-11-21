import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { auditSchema } from '@citeladder/contracts/audits';
import {
  objectionGroupSchema as groupSchema,
  probeMarketSchema,
  probeObjectionsSchema,
  probeStatusSchema,
  type ProbeRunRequest,
  type ProbeScheduleRequest,
  type ProbeStatus,
} from '@citeladder/contracts/probes';
import { strictValidate } from '@citeladder/contracts/validation';

import { apiClient, type ApiRequestOptions } from './client';
import { startInteractiveWork } from './interactive-work';
import { queryKeys } from './query-keys';
import type { ProjectScope } from './query-keys/scope';

const root = (projectId: string) => `/projects/${projectId}/probes`;

const probesApi = {
  status: async (projectId: string, options?: ApiRequestOptions) =>
    strictValidate(
      probeStatusSchema,
      await apiClient.get(root(projectId), options),
      'probes.status',
    ),
  run: async (projectId: string, input: ProbeRunRequest, options?: ApiRequestOptions) => {
    const res = await apiClient.post(root(projectId), input, options);
    const audits = strictValidate(z.array(auditSchema), res, 'probes.run');
    for (const audit of audits) startInteractiveWork(`/audits/${audit.id}/run`, options);
    return audits;
  },
  schedule: async (projectId: string, input: ProbeScheduleRequest, options?: ApiRequestOptions) =>
    strictValidate(
      probeStatusSchema,
      await apiClient.put(`${root(projectId)}/schedule`, input, options),
      'probes.schedule',
    ),
  market: async (projectId: string, options?: ApiRequestOptions) =>
    strictValidate(
      probeMarketSchema,
      await apiClient.get(`${root(projectId)}/market`, options),
      'probes.market',
    ),
  objections: async (projectId: string, options?: ApiRequestOptions) =>
    strictValidate(
      probeObjectionsSchema,
      await apiClient.get(`${root(projectId)}/objections`, options),
      'probes.objections',
    ),
  renameGroup: async (
    projectId: string,
    groupId: string,
    name: string,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      groupSchema,
      await apiClient.patch(`${root(projectId)}/objection-groups/${groupId}`, { name }, options),
      'probes.renameGroup',
    ),
  mergeGroup: async (
    projectId: string,
    groupId: string,
    intoId: string,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      groupSchema,
      await apiClient.post(
        `${root(projectId)}/objection-groups/${groupId}/merge`,
        { into_id: intoId },
        options,
      ),
      'probes.mergeGroup',
    ),
  removeGroup: (projectId: string, groupId: string, options?: ApiRequestOptions) =>
    apiClient.delete<void>(`${root(projectId)}/objection-groups/${groupId}`, options),
};

const scoped = (scope: ProjectScope) => ({ workspaceId: scope.workspaceId });
const PROBE_POLL_MS = 5000;

export const probeBusy = (status: ProbeStatus | undefined) =>
  status?.latest?.state === 'running' || status?.latest?.state === 'labelling';

export const probeBasis = (status: ProbeStatus | undefined) =>
  `${status?.latest?.launch_id ?? 'none'}:${status?.latest?.state ?? 'none'}`;

export const probeQueries = {
  status: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.projects.probes(scope),
      queryFn: ({ signal }) => probesApi.status(scope.projectId, { signal, ...scoped(scope) }),
      refetchInterval: (query) => (probeBusy(query.state.data) ? PROBE_POLL_MS : false),
    }),
  market: (scope: ProjectScope, basis: string) =>
    queryOptions({
      queryKey: queryKeys.projects.probeRead(scope, 'market', basis),
      queryFn: ({ signal }) => probesApi.market(scope.projectId, { signal, ...scoped(scope) }),
    }),
  objections: (scope: ProjectScope, basis: string) =>
    queryOptions({
      queryKey: queryKeys.projects.probeRead(scope, 'objections', basis),
      queryFn: ({ signal }) => probesApi.objections(scope.projectId, { signal, ...scoped(scope) }),
    }),
};

export function refreshProbeStatus(client: QueryClient, scope: ProjectScope) {
  void client.invalidateQueries({ queryKey: queryKeys.projects.probes(scope) });
}

export const probeMutations = {
  run: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (fingerprint: string) =>
        probesApi.run(scope.projectId, { fingerprint }, scoped(scope)),
      onSuccess: (_audits, _input, _result, { client }) => {
        refreshProbeStatus(client, scope);
        void client.invalidateQueries({ queryKey: queryKeys.runs.all });
      },
      onError: (_error, _input, _result, { client }) => refreshProbeStatus(client, scope),
    }),
  schedule: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (input: ProbeScheduleRequest) =>
        probesApi.schedule(scope.projectId, input, scoped(scope)),
      onSuccess: (status, _input, _result, { client }) => {
        client.setQueryData(queryKeys.projects.probes(scope), status);
        void client.invalidateQueries({ queryKey: queryKeys.runs.schedules(scope) });
      },
      onError: (_error, _input, _result, { client }) => refreshProbeStatus(client, scope),
    }),
  renameGroup: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: ({ id, name }: { id: string; name: string }) =>
        probesApi.renameGroup(scope.projectId, id, name, scoped(scope)),
      onSuccess: (_group, _input, _result, { client }) => refreshProbeStatus(client, scope),
    }),
  mergeGroup: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: ({ id, intoId }: { id: string; intoId: string }) =>
        probesApi.mergeGroup(scope.projectId, id, intoId, scoped(scope)),
      onSuccess: (_group, _input, _result, { client }) => refreshProbeStatus(client, scope),
    }),
  removeGroup: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (id: string) => probesApi.removeGroup(scope.projectId, id, scoped(scope)),
      onSuccess: (_data, _input, _result, { client }) => refreshProbeStatus(client, scope),
    }),
};
