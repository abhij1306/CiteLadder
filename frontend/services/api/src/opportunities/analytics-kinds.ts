/** The Opportunity analytics kinds. */
import type { AnalyticsKinds } from '../queue/executor.ts';
import { refreshOpportunities } from './refresh.ts';
import { verifyImplementationEvents } from './verification.ts';

export const opportunityKinds = {
  opportunity_refresh: { run: refreshOpportunities },
  opportunity_verification: { run: verifyImplementationEvents },
} as const satisfies AnalyticsKinds;
