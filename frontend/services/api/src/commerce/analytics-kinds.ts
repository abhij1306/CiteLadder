/** The Commerce analytics kinds. */
import type { AnalyticsKinds } from '../queue/executor.ts';
import { matchAnswers } from './answer-matching.ts';
import { competitorDiscovery } from './discovery.ts';
import { projectCatalog } from './projection.ts';

export const commerceKinds = {
  commerce_competitor_discovery: { run: competitorDiscovery() },
  commerce_catalog_projection: { run: projectCatalog },
  commerce_answer_matching: { run: matchAnswers },
} as const satisfies AnalyticsKinds;
