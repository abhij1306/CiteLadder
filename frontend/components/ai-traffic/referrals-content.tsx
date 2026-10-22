import type { UseQueryResult } from '@tanstack/react-query';

import { AiReferralsEmptyState } from '@/components/ai-traffic/empty-state';
import { Alert } from '@/components/ui/alert';
import { ProjectRequiredState } from '@/components/layout/project-required-state';
import type { FilterBarProps } from '@/components/ui/filter-bar';
import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { readErrorProps } from '@/components/ui/read-error';
import { rangeLabel, type AiReferralsRange } from '@/lib/ai-traffic/options';
import { isAiReferralsEmpty } from '@/lib/ai-traffic/series';
import type { AiReferrals } from '@/lib/api/ai-traffic';

import { AiReferralsDashboard } from './referrals-dashboard';
import { PageShell } from '@/components/layout/page-shell';
import { TabPanel, type TabRowProps } from '@/components/ui/tabs';

export function AiReferralsContent({
  projectId,
  projectLoading,
  range,
  query,
  controls,
  tabs,
  notice,
}: Readonly<{
  projectId: string | null;
  projectLoading: boolean;
  range: AiReferralsRange;
  query: UseQueryResult<AiReferrals, Error>;
  controls: FilterBarProps;
  tabs?: TabRowProps;
  notice?: React.ReactNode;
}>) {
  // The control band stays drawn while the project resolves. Hiding it left the
  // work jumping a row's height the moment data arrived.
  const data = (
    <AiReferralsDataRegion
      projectId={projectId}
      projectLoading={projectLoading}
      range={range}
      query={query}
    />
  );
  const region = notice ? (
    <Stack gap="section">
      {notice}
      {data}
    </Stack>
  ) : (
    data
  );
  return (
    <PageShell tabs={tabs} controls={controls}>
      {tabs ? <TabPanel value="referrals">{region}</TabPanel> : region}
    </PageShell>
  );
}

function AiReferralsDataRegion({
  projectId,
  projectLoading,
  range,
  query,
}: Omit<React.ComponentProps<typeof AiReferralsContent>, 'controls' | 'notice'>) {
  if (projectLoading || (Boolean(projectId) && query.isLoading))
    return <QueryState kind="loading" label="Loading AI referrals…" />;
  if (!projectId) return <ProjectRequiredState />;
  if (query.isError) {
    return (
      <QueryState
        kind="error"
        {...readErrorProps(query)}
        fallback="AI referrals could not be loaded. Check your connection and try again."
      />
    );
  }

  const data = query.data ?? null;
  if (!data || (isAiReferralsEmpty(data) && range === 'latest')) return <AiReferralsEmptyState />;
  if (isAiReferralsEmpty(data)) return <AiReferralsNoSnapshot range={range} />;

  return <AiReferralsDashboard data={data} fetching={query.isFetching} />;
}

/**
 * Nothing is PROJECTED at this length yet — distinct from "measured zero",
 * which renders as a dashboard of zeroes. The preset is named rather than a
 * date window: the server resolves a preset against persisted evidence, so
 * there are no client-side bounds to quote, and quoting a window the client
 * invented is what made this surface wrong in the first place.
 */
function AiReferralsNoSnapshot({ range }: Readonly<{ range: AiReferralsRange }>) {
  return (
    <Alert tone="info">
      No synced AI-referral snapshot covers {rangeLabel(range).toLowerCase()} yet. Switch to the
      latest synced window, or run a sync from Performance.
    </Alert>
  );
}
