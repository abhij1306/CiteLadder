/** Typed client for persisted Demand Intelligence projections. */
import { z } from 'zod';

import { apiClient, type ApiRequestOptions } from './client';
import {
  demandRecomputeResponseSchema,
  demandSignalSchema,
  demandSnapshotSchema,
} from '@citeladder/contracts';
import { strictValidate } from '@citeladder/contracts/validation';

export type DemandSignal = z.infer<typeof demandSignalSchema>;
export type DemandSnapshot = z.infer<typeof demandSnapshotSchema>;

export const demandApi = {
  getLatest: async (projectId: string, options?: ApiRequestOptions) =>
    strictValidate(
      demandSnapshotSchema,
      await apiClient.get<unknown>(`/projects/${projectId}/demand/latest`, options),
      'demand.getLatest',
    ),
  recompute: async (
    projectId: string,
    payload: { window_start: string; window_end: string },
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      demandRecomputeResponseSchema,
      await apiClient.post<unknown>(`/projects/${projectId}/demand/recompute`, payload, options),
      'demand.recompute',
    ),
};
