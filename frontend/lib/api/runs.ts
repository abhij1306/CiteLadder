/**
 * Runs (audits) + executions domain endpoints: launch, list, poll detail,
 * cancel, executions list + single-execution evidence, and export URLs. Run
 * progress is polling-first (`getAudit`). Every JSON response passes through
 * `strictValidate`.
 */
import { z } from 'zod';
import { mutationOptions, queryOptions, skipToken, type QueryClient } from '@tanstack/react-query';

import { API_BASE_URL } from '@/lib/config/operational';
import { apiClient, type ApiRequestOptions } from './client';
import { queryKeys } from './query-keys';
import type { ProjectScope } from './query-keys/scope';
import {
  auditEstimateSchema,
  auditScheduleSchema,
  auditSchema,
  executionEvidenceSchema,
  executionSchema,
} from '@citeladder/contracts/audits';
import type {
  AuditEstimateRequest,
  AuditLaunchRequest,
  AuditRepairRequest,
  AuditScheduleCreateRequest,
  AuditScheduleUpdateRequest,
} from '@citeladder/contracts/audit-requests';
import { strictValidate } from '@citeladder/contracts/validation';
import { definedQuery, withQuery } from './shared';
import { startInteractiveWork } from './interactive-work';
import type { Audit, AuditSchedule, Execution, ExecutionEvidence } from '@citeladder/contracts';

const auditListSchema = z.array(auditSchema);
const executionListSchema = z.array(executionSchema);
const auditScheduleListSchema = z.array(auditScheduleSchema);

export const runsApi = {
  estimateAudit: async (input: AuditEstimateRequest, options?: ApiRequestOptions) => {
    const res = await apiClient.post('/audits/estimate', input, options);
    return strictValidate(auditEstimateSchema, res, 'runs.estimateAudit');
  },
  /** One launch: a queued run per selected market, each driven to its first results. */
  launchAudit: async (input: AuditLaunchRequest, options?: ApiRequestOptions) => {
    const res = await apiClient.post<Audit[]>('/audits', input, options);
    const audits = strictValidate(auditListSchema, res, 'runs.launchAudit');
    for (const audit of audits) startInteractiveWork(`/audits/${audit.id}/run`, options);
    return audits;
  },
  listAudits: async (params?: { project_id?: string }, options?: ApiRequestOptions) => {
    const path = withQuery('/audits', definedQuery(params));
    const res = await apiClient.get<Audit[]>(path, options);
    return strictValidate(auditListSchema, res, 'runs.listAudits');
  },
  getAudit: async (auditId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<Audit>(`/audits/${auditId}`, options);
    return strictValidate(auditSchema, res, 'runs.getAudit');
  },
  cancelAudit: async (auditId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.post<Audit>(`/audits/${auditId}/cancel`, undefined, options);
    return strictValidate(auditSchema, res, 'runs.cancelAudit');
  },
  rerunFailures: async (
    auditId: string,
    input: AuditRepairRequest = {},
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.post<Audit>(`/audits/${auditId}/rerun-failures`, input, options);
    const audit = strictValidate(auditSchema, res, 'runs.rerunFailures');
    startInteractiveWork(`/audits/${audit.id}/run`, options);
    return audit;
  },
  listSchedules: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<AuditSchedule[]>(
      `/projects/${projectId}/audit-schedules`,
      options,
    );
    return strictValidate(auditScheduleListSchema, res, 'runs.listSchedules');
  },
  createSchedule: async (
    projectId: string,
    input: AuditScheduleCreateRequest,
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.post<AuditSchedule>(
      `/projects/${projectId}/audit-schedules`,
      input,
      options,
    );
    return strictValidate(auditScheduleSchema, res, 'runs.createSchedule');
  },
  updateSchedule: async (
    projectId: string,
    scheduleId: string,
    input: AuditScheduleUpdateRequest,
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.patch<AuditSchedule>(
      `/projects/${projectId}/audit-schedules/${scheduleId}`,
      input,
      options,
    );
    return strictValidate(auditScheduleSchema, res, 'runs.updateSchedule');
  },
  listExecutions: async (auditId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<Execution[]>(`/audits/${auditId}/executions`, options);
    return strictValidate(executionListSchema, res, 'runs.listExecutions');
  },
  getExecution: async (executionId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<ExecutionEvidence>(`/executions/${executionId}`, options);
    return strictValidate(executionEvidenceSchema, res, 'runs.getExecution');
  },
  /** Fetch an export through the authenticated client so workspace scope is explicit. */
  downloadExport: (auditId: string, format: 'csv' | 'md', options: ApiRequestOptions) =>
    apiClient.getBlob(`/audits/${auditId}/export.${format}`, options),
  /**
   * Same-origin SSE endpoint (optional; polling is the baseline). The backend
   * `/events` endpoint returns JSON by default and an SSE `text/event-stream`
   * only with `?stream=true`, so the streaming helper must request it.
   */
  eventsUrl: (auditId: string) => `${API_BASE_URL}/audits/${auditId}/events?stream=true`,
};

const scoped = (scope: ProjectScope) => ({ workspaceId: scope.workspaceId });

/** Run reads: navigation intent, the app provider and run screens share these keys. */
export const runsQueries = {
  /**
   * The estimate for a launch the dialog would send. Keyed by the
   * workspace and the exact payload; with either missing there is
   * nothing to estimate yet, so the query skips.
   */
  estimate: (workspaceId: string | null, input: AuditEstimateRequest | null) =>
    queryOptions({
      queryKey: queryKeys.runs.estimate(workspaceId, input),
      queryFn:
        workspaceId && input
          ? ({ signal }) => runsApi.estimateAudit(input, { signal, workspaceId })
          : skipToken,
    }),
  list: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.runs.list(scope),
      queryFn: ({ signal }) =>
        runsApi.listAudits({ project_id: scope.projectId }, { signal, ...scoped(scope) }),
    }),
  schedules: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.runs.schedules(scope),
      queryFn: ({ signal }) => runsApi.listSchedules(scope.projectId, { signal, ...scoped(scope) }),
    }),
  detail: (workspaceId: string | null, auditId: string) =>
    queryOptions({
      queryKey: queryKeys.runs.detail(workspaceId, auditId),
      queryFn: ({ signal }) => runsApi.getAudit(auditId, { signal, workspaceId }),
    }),
  executions: (workspaceId: string | null, auditId: string) =>
    queryOptions({
      queryKey: queryKeys.runs.executions(workspaceId, auditId),
      queryFn: ({ signal }) => runsApi.listExecutions(auditId, { signal, workspaceId }),
    }),
  /** One execution's persisted evidence; skips until an execution is chosen. */
  execution: (workspaceId: string | null, executionId: string | null) =>
    queryOptions({
      queryKey: queryKeys.runs.execution(workspaceId, executionId ?? ''),
      queryFn: executionId
        ? ({ signal }) => runsApi.getExecution(executionId, { signal, workspaceId })
        : skipToken,
    }),
};

/**
 * Reads derived from finished audits: Visibility, and Commerce's product
 * metrics and Actions. A completed or cancelled run refreshes each of them; this is
 * the one place that says which.
 */
export function refreshAuditResults(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.visibility.all }),
    client.invalidateQueries({ queryKey: queryKeys.commerce.all }),
  ]);
}

/** A run's own row and executions, after its stream or its progress moved. */
export const refreshAuditDetail = (client: QueryClient, auditId: string) =>
  client.invalidateQueries({ queryKey: queryKeys.runs.auditDetail(auditId) });
export const refreshAuditExecutions = (client: QueryClient, auditId: string) =>
  client.invalidateQueries({ queryKey: queryKeys.runs.auditExecutions(auditId) });

/** Run writes; each success refreshes every read it changes. */
export const runsMutations = {
  /** One launch: a queued run per selected market, each written into the cache at once. */
  launch: (workspaceId: string | null) =>
    mutationOptions({
      mutationFn: (input: AuditLaunchRequest) => {
        if (!workspaceId) throw new Error('Workspace is not available.');
        return runsApi.launchAudit(input, { workspaceId });
      },
      onSuccess: async (audits, _input, _result, { client }) => {
        for (const audit of audits)
          client.setQueryData(queryKeys.runs.detail(workspaceId, audit.id), audit);
        await client.invalidateQueries({ queryKey: queryKeys.runs.all });
      },
    }),
  /** A cancelled run finalizes what it measured: every audit-derived read refreshes. */
  cancel: (workspaceId: string | null, auditId: string) =>
    mutationOptions({
      mutationFn: () => runsApi.cancelAudit(auditId, { workspaceId }),
      onSuccess: (audit, _input, _result, { client }) => {
        client.setQueryData(queryKeys.runs.detail(workspaceId, auditId), audit);
        return Promise.all([
          client.invalidateQueries({ queryKey: queryKeys.runs.all }),
          refreshAuditResults(client),
        ]);
      },
    }),
  /** A repair run for the failed executions; the run list gains it. */
  rerunFailures: (workspaceId: string | null, auditId: string) =>
    mutationOptions({
      mutationFn: () => runsApi.rerunFailures(auditId, {}, { workspaceId }),
      onSuccess: (_audit, _input, _result, { client }) =>
        client.invalidateQueries({ queryKey: queryKeys.runs.all }),
    }),
  createSchedule: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (input: AuditScheduleCreateRequest) =>
        runsApi.createSchedule(scope.projectId, input, scoped(scope)),
      onSuccess: (_schedule, _input, _result, { client }) =>
        client.invalidateQueries({ queryKey: queryKeys.runs.schedules(scope) }),
    }),
  /** Resume a paused schedule. */
  resumeSchedule: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (scheduleId: string) =>
        runsApi.updateSchedule(scope.projectId, scheduleId, { enabled: true }, scoped(scope)),
      onSuccess: (_schedule, _input, _result, { client }) =>
        client.invalidateQueries({ queryKey: queryKeys.runs.schedules(scope) }),
    }),
};
