import type { UseQueryResult } from '@tanstack/react-query';

import { AiReferralsEmptyState } from '@/components/ai-traffic/empty-state';
import { Callout } from '@/components/ui/callout';
import type { FilterBarProps } from '@/components/ui/filter-bar';
import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { readErrorProps } from '@/components/ui/read-error';
import { rangeLabel, type AiReferralsRange } from '@/lib/ai-traffic/options';
import { isAiReferralsEmpty } from '@/lib/ai-traffic/series';
import type { AiReferrals } from '@/lib/api/ai-traffic';

import { AiReferralsDashboard } from './referrals-dashboard';
import { ListScreen } from '@/components/layout/page-shell';
import { TabPanel, type TabRowProps } from '@/components/ui/tabs';

export function AiReferralsContent({
  range,
  query,
  controls,
  tabs,
  notice,
}: Readonly<{
  range: AiReferralsRange;
  query: UseQueryResult<AiReferrals, Error>;
  controls: FilterBarProps;
  tabs?: TabRowProps;
  notice?: React.ReactNode;
}>) {
  // The control band stays drawn while the data loads. Hiding it left the
  // work jumping a row's height the moment data arrived.
  const data = <AiReferralsDataRegion range={range} query={query} />;
  const region = notice ? (
    <Stack gap="section">
      {notice}
      {data}
    </Stack>
  ) : (
    data
  );
  return (
    <ListScreen tabs={tabs} controls={controls}>
      {tabs ? <TabPanel value="referrals">{region}</TabPanel> : region}
    </ListScreen>
  );
}

function AiReferralsDataRegion({
  range,
  query,
}: Omit<React.ComponentProps<typeof AiReferralsContent>, 'controls' | 'notice' | 'tabs'>) {
  if (query.isLoading) return <QueryState kind="loading" label="Loading AI referrals…" />;
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
    <Callout tone="info">
      No synced AI-referral snapshot covers {rangeLabel(range).toLowerCase()} yet. Switch to the
      latest synced window, or run a sync from Performance.
    </Callout>
  );
}
