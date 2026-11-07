/** The AI Traffic composition's analytics kinds. */
import type { AnalyticsKinds } from '../queue/executor.ts';
import { refreshTrafficInsights } from './insights.ts';

export const aiTrafficKinds = {
  ai_traffic_insights_refresh: { run: refreshTrafficInsights },
} as const satisfies AnalyticsKinds;
