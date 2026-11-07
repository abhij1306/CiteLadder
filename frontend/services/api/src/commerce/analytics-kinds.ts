/** The Commerce analytics kinds. */
import type { AnalyticsKinds } from '../queue/executor.ts';
import { competitorDiscovery } from './discovery.ts';
import { projectCatalog } from './projection.ts';

export const commerceKinds = {
  commerce_competitor_discovery: { run: competitorDiscovery() },
  commerce_catalog_projection: { run: projectCatalog },
} as const satisfies AnalyticsKinds;
