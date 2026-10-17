/**
 * Runs (audits) + executions domain endpoints: launch, list, poll detail,
 * cancel, executions list + single-execution evidence, and export URLs. Run
 * progress is polling-first (`getAudit`). Every JSON response passes through
 * `strictValidate`.
 */
import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';

import { API_BASE_URL, apiClient, type ApiRequestOptions } from './client';
import { queryKeys } from './query-keys';
import {
  auditEstimateSchema,
  auditScheduleSchema,
  auditSchema,
  executionEvidenceSchema,
  executionSchema,
} from '@citeladder/contracts/audits';
import { strictValidate } from '@citeladder/contracts/validation';
import { definedQuery, withQuery } from './shared';
import { startInteractiveWork } from './interactive-work';
import type {
  Audit,
  AuditSchedule,
  AuditScheduleCadence,
  Execution,
  ExecutionEvidence,
  LogicalEngine,
} from './types';

const auditListSchema = z.array(auditSchema);
const executionListSchema = z.array(executionSchema);
const auditScheduleListSchema = z.array(auditScheduleSchema);

/**
 * `POST /audits` body (`AuditCreate`). The workspace is resolved from the
 * `X-Workspace-Id` header, so it is not part of the body. A run measures a
 * project's prompts (a whole `prompt_set_id`, or explicit `prompt_ids`) across
 * one or more logical `engines`; provider keys are never carried here.
 */
export type LaunchAuditInput = {
  project_id: string;
  prompt_set_id?: string;
  prompt_ids?: string[];
  engines: LogicalEngine[];
  /** One run per market; `null` is the project default (the default selection). */
  market_ids?: (string | null)[];
  repetitions?: number;
  benchmark_mode?: string;
  audit_scope?: 'brand' | 'commerce';
  /** Optional 64-bit seed as a decimal string; generated + stored when omitted. */
  random_seed?: string;
};

export type AuditRepairInput = {
  provider?: string;
  engine?: string;
  prompt_id?: string;
  task_ids?: string[];
};

export type CreateAuditScheduleInput = {
  prompt_set_id: string;
  audit_scope?: 'brand' | 'commerce';
  cadence: AuditScheduleCadence;
  interval_minutes?: number;
  timezone?: string;
  engines: LogicalEngine[];
  market_ids?: (string | null)[];
  repetitions?: number;
  benchmark_mode?: string;
  enabled?: boolean;
  next_run_at?: string;
};

export const runsApi = {
  estimateAudit: async (input: LaunchAuditInput, options?: ApiRequestOptions) => {
    const res = await apiClient.post('/audits/estimate', input, options);
    return strictValidate(auditEstimateSchema, res, 'runs.estimateAudit');
  },
  /** One launch: a queued run per selected market, each driven to its first results. */
  launchAudit: async (input: LaunchAuditInput, options?: ApiRequestOptions) => {
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
    input: AuditRepairInput = {},
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
    input: CreateAuditScheduleInput,
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
    input: { enabled: boolean },
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
  list: (workspaceId: string, projectId: string) =>
    queryOptions({
      queryKey: queryKeys.runs.list({ project_id: projectId }),
      queryFn: ({ signal }) =>
        runsApi.listAudits({ project_id: projectId }, { signal, workspaceId }),
    }),
};
