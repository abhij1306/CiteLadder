/**
 * Runs (audits) + executions domain endpoints: launch, list, poll detail,
 * cancel, executions list + single-execution evidence, and export URLs. Run
 * progress is polling-first (`getAudit`). Every JSON response passes through
 * `strictValidate`.
 */
import { z } from 'zod';
import { queryOptions, skipToken } from '@tanstack/react-query';

import { API_BASE_URL } from '@/lib/config/operational';
import { apiClient, type ApiRequestOptions } from './client';
import { queryKeys } from './query-keys';
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

/** Shared list options keep navigation, the app provider, and run screens on one cache identity. */
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
  list: (workspaceId: string, projectId: string) =>
    queryOptions({
      queryKey: queryKeys.runs.list({ project_id: projectId }),
      queryFn: ({ signal }) =>
        runsApi.listAudits({ project_id: projectId }, { signal, workspaceId }),
    }),
};
