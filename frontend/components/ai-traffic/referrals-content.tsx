import type { UseQueryResult } from '@tanstack/react-query';

import { AiReferralsEmptyState } from '@/components/ai-traffic/empty-state';
import { FilterBar, type FilterBarProps } from '@/components/ui/filter-bar';
import { DEFAULT_RANGE, rangeLabel, type AiReferralsRange } from '@/lib/ai-traffic/options';
import { isAiReferralsEmpty } from '@/lib/ai-traffic/series';
import type { AiReferrals } from '@/lib/api/ai-traffic';

import { AiReferralsDashboard } from './referrals-dashboard';
import { ReportPage } from '@/components/templates/report-page';
import { TabPanel, TabRow, type TabRowProps } from '@/components/ui/tabs';
import { SectionStack } from '@/components/ui/section';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';

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
  const data = <AiReferralsDataRegion range={range} query={query} />;
  const region = notice ? (
    <SectionStack>
      {notice}
      {data}
    </SectionStack>
  ) : (
    data
  );
  return (
    <ReportPage
      tabs={tabs ? <TabRow {...tabs} /> : undefined}
      filters={<FilterBar {...controls} />}
    >
      {tabs ? <TabPanel value="referrals">{region}</TabPanel> : region}
    </ReportPage>
  );
}

function AiReferralsDataRegion({
  range,
  query,
}: Omit<React.ComponentProps<typeof AiReferralsContent>, 'controls' | 'notice' | 'tabs'>) {
  if (query.isLoading)
    return <StateBlock kind="loading" label="Loading AI referrals…" shape={{ kind: 'chart' }} />;
  if (query.isError) {
    return (
      <StateBlock
        kind="error"
        {...readErrorProps(query)}
        title="Couldn't load the AI referrals"
        fallback="The request failed or timed out."
      />
    );
  }

  const data = query.data ?? null;
  const emptyMeansUnsynced = range === 'latest' || range === DEFAULT_RANGE;
  if (!data || (isAiReferralsEmpty(data) && emptyMeansUnsynced)) return <AiReferralsEmptyState />;
  if (isAiReferralsEmpty(data)) return <AiReferralsNoSnapshot range={range} />;

  return <AiReferralsDashboard data={data} fetching={query.isFetching} />;
}

function AiReferralsNoSnapshot({ range }: Readonly<{ range: AiReferralsRange }>) {
  return (
    <Notice tone="info">
      No synced AI-referral snapshot covers {rangeLabel(range).toLowerCase()} yet.
    </Notice>
  );
}
