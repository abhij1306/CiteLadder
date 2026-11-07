/** The Keyword Research analytics kind. */
import type { AnalyticsKinds } from '../queue/executor.ts';
import { acquireResearch } from './executor.ts';

export const searchIntelligenceKinds = {
  search_intelligence_acquisition: { run: acquireResearch },
} as const satisfies AnalyticsKinds;
