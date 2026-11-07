/** The Traffic and Performance analytics kinds. */
import type { AnalyticsKinds } from '../queue/executor.ts';
import { projectPerformanceRange, refreshTrafficSnapshot } from './snapshot.ts';

export const trafficKinds = {
  traffic_snapshot_refresh: { run: refreshTrafficSnapshot },
  performance_range_projection: { run: projectPerformanceRange },
} as const satisfies AnalyticsKinds;
