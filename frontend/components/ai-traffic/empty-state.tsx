import { BarChart3, SearchX } from 'lucide-react';

import { DataSourceSetup } from '@/components/integrations/data-source-setup';
import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { CrawlLogConnections } from './crawl-log-connections';

/**
 * A filtered AI Traffic table with no matching rows. It replaces the table
 * rather than drawing column headers over nothing, and says absence is an
 * observation within the available logs, not proof of no traffic.
 */
export function TrafficNoResults({
  heading,
  description,
  connectLogs = false,
}: Readonly<{ heading: string; description: string; connectLogs?: boolean }>) {
  return (
    <Stack gap="workspace">
      <QueryState kind="empty" icon={SearchX} heading={heading} description={description} />
      {connectLogs ? <CrawlLogConnections /> : null}
    </Stack>
  );
}

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
      description="AI referrals come from this project's own GA4 sessions. Connect Google and choose the Analytics property for this site."
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
