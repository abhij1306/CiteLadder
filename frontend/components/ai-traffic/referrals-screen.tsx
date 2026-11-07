'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { AiReferralsContent } from '@/components/ai-traffic/referrals-content';
import { FilterChoice, type FilterBarProps } from '@/components/ui/filter-bar';
import { Spinner } from '@/components/ui/spinner';
import { SegmentedControl, type TabRowProps } from '@/components/ui/tabs';
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
        fetching: dashboardQuery.isFetching,
      })}
    />
  );
}

function referralsControls({
  range,
  onChangeRange,
  granularity,
  onChangeGranularity,
  fetching,
}: Readonly<{
  range: AiReferralsRange;
  onChangeRange: (range: AiReferralsRange) => void;
  granularity: AiReferralsGranularity;
  onChangeGranularity: (granularity: AiReferralsGranularity) => void;
  fetching: boolean;
}>): FilterBarProps {
  return {
    status: fetching ? (
      <>
        <Spinner />
        Updating data… Previous data shown.
      </>
    ) : null,
    filters: (
      // Segments, then the range trigger: the one order Performance uses too.
      <>
        <SegmentedControl
          value={granularity}
          onChange={onChangeGranularity}
          options={GRANULARITY_OPTIONS}
          ariaLabel="Chart interval"
        />
        <FilterChoice
          label="Range"
          menuLabel="Date range"
          value={range}
          defaultValue="latest"
          options={RANGE_OPTIONS}
          onChange={onChangeRange}
        />
      </>
    ),
  };
}
