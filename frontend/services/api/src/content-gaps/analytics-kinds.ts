/** The content-angle analytics kind. */
import type { AnalyticsKinds } from '../queue/executor.ts';
import { compensateContentAngles, contentAngleRefresh } from './refresh.ts';

export const contentGapKinds = {
  content_angle_refresh: { run: contentAngleRefresh(), compensate: compensateContentAngles },
} as const satisfies AnalyticsKinds;
