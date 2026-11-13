import { BarChart3 } from 'lucide-react';

import { DataSourceSetup } from '@/components/integrations/data-source-setup';
import { QueryState } from '@/components/ui/query-state';

/**
 * Empty state for the AI Traffic referrals view. Referral measurement begins
 * once a GA4 source/medium report has been imported, so GA4 is connected here
 * rather than in Settings; once it is, only the waiting-for-import line shows.
 */
export function AiReferralsEmptyState() {
  return (
    <DataSourceSetup
      required={['ga4']}
      title="Connect Google Analytics 4"
      whenReady={
        <QueryState
          kind="empty"
          icon={BarChart3}
          heading="No AI-referral data yet"
          description="Referrals appear here once GA4 sessions have been imported."
        />
      }
    />
  );
}
