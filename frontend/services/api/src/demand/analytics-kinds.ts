/** The Search Demand analytics kind. */
import type { AnalyticsKinds } from '../queue/executor.ts';
import { recomputeDemand } from './snapshot.ts';

export const demandKinds = {
  demand_snapshot_refresh: { run: recomputeDemand },
} as const satisfies AnalyticsKinds;
