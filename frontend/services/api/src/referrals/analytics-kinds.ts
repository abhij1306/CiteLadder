/** The AI Referrals chain's analytics kinds. */
import type { AnalyticsKinds } from '../queue/executor.ts';
import { classifyReferrals } from './classify.ts';
import { ingestReferrals } from './ingest.ts';
import { referralRetentionSweep } from './retention.ts';
import { refreshAiReferralsSnapshot } from './snapshot.ts';

export const referralKinds = {
  ingest_referrals: { run: ingestReferrals },
  classify_referrals: { run: classifyReferrals },
  ai_referrals_snapshot_refresh: { run: refreshAiReferralsSnapshot },
  referral_retention_sweep: { run: referralRetentionSweep },
} as const satisfies AnalyticsKinds;
