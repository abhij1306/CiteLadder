import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { AiReferralsContent } from '@/components/ai-traffic/referrals-content';
import { choiceFilter } from '@/components/ui/all-filters';
import type { FilterBarProps } from '@/components/ui/filter-bar';
import { Spinner } from '@/components/ui/spinner';
import type { TabRowProps } from '@/components/ui/tabs';
import { aiTrafficQueries } from '@/lib/api/ai-traffic';
import { GRANULARITY_OPTIONS } from '@/lib/format';
import {
  RANGE_OPTIONS,
  rangeToParams,
  type AiReferralsGranularity,
  type AiReferralsRange,
} from '@/lib/ai-traffic/options';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';

const rangeCodec = stringUrlCodec<AiReferralsRange>(
  RANGE_OPTIONS.map((option) => option.value),
  'latest',
);
const granularityCodec = stringUrlCodec<AiReferralsGranularity>(
  GRANULARITY_OPTIONS.map((option) => option.value),
  'week',
);

export function AiReferralsScreen({
  tabs,
  notice,
}: Readonly<{
  tabs?: TabRowProps;
  /** Shown above the referrals, e.g. why crawl logs are unavailable. */
  notice?: React.ReactNode;
}> = {}) {
  const { workspaceId, projectId } = useProjectScope();
  // The range is the screen's shared `range` parameter, so a preset follows the reader across tabs.
  const [range, setRange] = useUrlState('range', rangeCodec);
  const [granularity, setGranularity] = useUrlState('granularity', granularityCodec);
  const rangeParams = useMemo(() => rangeToParams(range), [range]);
  const dashboardQuery = useQuery(
    aiTrafficQueries.dashboard({ workspaceId, projectId }, { ...rangeParams, granularity }),
  );

  return (
    <AiReferralsContent
      tabs={tabs}
      notice={notice}
      range={range}
      query={dashboardQuery}
      controls={referralsControls({
        range,
        onChangeRange: setRange,
        granularity,
        onChangeGranularity: setGranularity,
        // Only a read that has an answer on screen is "previous data shown";
        // the first load has none, and the content already says it is loading.
        refreshing: dashboardQuery.isFetching && dashboardQuery.data !== undefined,
      })}
    />
  );
}

function referralsControls({
  range,
  onChangeRange,
  granularity,
  onChangeGranularity,
  refreshing,
}: Readonly<{
  range: AiReferralsRange;
  onChangeRange: (range: AiReferralsRange) => void;
  granularity: AiReferralsGranularity;
  onChangeGranularity: (granularity: AiReferralsGranularity) => void;
  refreshing: boolean;
}>): FilterBarProps {
  return {
    status: refreshing ? (
      <>
        <Spinner />
        Updating data… Previous data shown.
      </>
    ) : null,
    // The same control row as the other AI Traffic tabs: the window and the
    // chart interval in All filters, the live note at the row's end.
    filters: [
      choiceFilter({
        id: 'range',
        label: 'Reporting range',
        value: range,
        defaultValue: 'latest',
        groups: [{ options: RANGE_OPTIONS }],
        onChange: onChangeRange,
      }),
      choiceFilter({
        id: 'granularity',
        label: 'Chart interval',
        value: granularity,
        defaultValue: 'week',
        groups: [{ options: GRANULARITY_OPTIONS }],
        onChange: onChangeGranularity,
      }),
    ],
  };
}
