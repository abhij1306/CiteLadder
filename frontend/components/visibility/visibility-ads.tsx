'use client';

import type { VisibilityAdsResponse } from '@citeladder/contracts/visibility-ads';
import { Megaphone } from 'lucide-react';

import { BusyBar } from '@/components/ui/busy-bar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { QueryState } from '@/components/ui/query-state';
import { ReadError } from '@/components/ui/read-error';
import { Skeleton } from '@/components/ui/skeleton';
import { StatRow } from '@/components/ui/stat-row';
import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { textRole } from '@/components/ui/typography';
import { MissingValue } from '@/components/ui/unavailable-value';
import { Inline, Stack } from '@/components/ui/layout';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatDisplayShortDate, formatPercent, measured, pluralCount } from '@/lib/format';
import {
  AD_APPLICABILITY,
  ADS_COVERAGE_NOTE,
  adsStateCopy,
  landingLabel,
  presenceLine,
} from '@/lib/visibility/ads';
import { engineLabel } from '@/lib/visibility/dashboard';
import { mergedAdPages, useAds } from '@/lib/visibility/use-ads';
import { AdOwnershipChip } from '@/components/visibility/ad-ownership-chip';
import type { SourceFilters } from '@/components/visibility/source-rows';
import type { SourceQueries } from '@/lib/visibility/use-source-analysis';

/**
 * Paid ads shown in ChatGPT Search answers. Ads are reported apart from
 * sources and citations; an engine without ads is not applicable, never zero.
 */
export function VisibilityAds({
  filters,
  queries,
}: Readonly<{ filters: SourceFilters; queries: SourceQueries }>) {
  const { query, enabled } = useAds(filters, queries);
  const [firstPage, ...laterPages] = query.data?.pages ?? [];
  if (query.error)
    return (
      <ReadError
        error={query.error}
        fallback="Could not load ads. Check your connection and try again."
        onRetry={() => void query.refetch()}
        pending={query.isFetching}
      />
    );
  // A range with no runs reads nothing; otherwise the selection is still resolving.
  if (!enabled)
    return queries.selectedRunIds?.length === 0 ? <AdsState state="no_runs" /> : <AdsLoading />;
  if (!firstPage) return <AdsLoading />;
  return (
    <div className="relative">
      <BusyBar active={query.isFetching && !query.isFetchingNextPage} label="Updating ads" />
      <AdsView
        data={mergedAdPages([firstPage, ...laterPages])}
        onShowMore={query.hasNextPage ? () => void query.fetchNextPage() : undefined}
        loadingMore={query.isFetchingNextPage}
      />
    </div>
  );
}

function AdsLoading() {
  return (
    <Stack gap="workspace" aria-busy>
      <Skeleton shape="block" />
      <Skeleton shape="chart" />
    </Stack>
  );
}

export function AdsView({
  data,
  onShowMore,
  loadingMore = false,
}: Readonly<{ data: VisibilityAdsResponse; onShowMore?: () => void; loadingMore?: boolean }>) {
  if (data.state !== 'value') return <AdsState state={data.state} engines={data.engines} />;
  return (
    <Stack gap="workspace">
      <Headline data={data} />
      <AdvertiserTable advertisers={data.advertisers} total={data.advertisers_seen} />
      <PromptTable prompts={data.prompts} />
      <CreativeList creatives={data.creatives} onShowMore={onShowMore} loadingMore={loadingMore} />
    </Stack>
  );
}

function CoverageNote() {
  return <p className={textRole('caption', 'text-muted')}>{ADS_COVERAGE_NOTE}</p>;
}

/** A read with no ads to show, with each engine's applicability named. */
function AdsState({
  state,
  engines = [],
}: Readonly<{
  state: Exclude<VisibilityAdsResponse['state'], 'value'> | 'no_runs';
  engines?: VisibilityAdsResponse['engines'];
}>) {
  const copy = adsStateCopy(state);
  return (
    <Card>
      <CardContent>
        <Stack gap="item">
          <QueryState
            kind="empty"
            headingLevel={3}
            icon={Megaphone}
            heading={copy.heading}
            description={copy.description}
          />
          <EngineApplicability engines={engines} />
        </Stack>
      </CardContent>
    </Card>
  );
}

function EngineApplicability({ engines }: Readonly<{ engines: VisibilityAdsResponse['engines'] }>) {
  if (!engines.length) return null;
  return (
    <Inline as="ul" gap="meta" className={textRole('caption', 'text-muted')}>
      {engines.map((engine) => (
        <li key={engine.engine}>
          {engineLabel(engine.engine)}: {AD_APPLICABILITY[engine.applicability]}
        </li>
      ))}
    </Inline>
  );
}

function Headline({ data }: Readonly<{ data: VisibilityAdsResponse }>) {
  return (
    <Card>
      <CardContent>
        <Stack gap="item">
          <StatRow
            label="Ads in ChatGPT answers"
            segments={[
              {
                key: 'presence',
                label: 'Ad presence',
                value: measured(formatPercent(data.presence.rate)),
                missingLabel: 'Unavailable',
                sub: presenceLine(data.presence),
              },
              {
                key: 'brand',
                label: 'Your ad share',
                value: measured(formatPercent(data.brand.share)),
                missingLabel: 'Not advertising',
                sub:
                  data.brand.best_rank === null
                    ? 'No ads of yours were seen.'
                    : `${data.brand.appearances} of your ads; best position ${data.brand.best_rank}`,
              },
              {
                key: 'advertisers',
                label: 'Advertisers seen',
                value: data.advertisers_seen,
                sub: 'Distinct advertiser domains in these answers.',
              },
            ]}
          />
          <EngineApplicability engines={data.engines} />
          <CoverageNote />
        </Stack>
      </CardContent>
    </Card>
  );
}

function AdvertiserTable({
  advertisers,
  total,
}: Readonly<{ advertisers: VisibilityAdsResponse['advertisers']; total: number }>) {
  const timeZone = useDisplayTimeZone();
  return (
    <DataTable
      title="Advertisers"
      columns={ADVERTISER_COLUMNS}
      footer={
        advertisers.length < total
          ? `The ${advertisers.length} most frequent of ${total} advertisers.`
          : 'Who paid to appear in these answers.'
      }
      state={advertisers.length ? undefined : noAds('No ads in these answers.')}
    >
      {advertisers.map((advertiser) => (
        <TableRow key={advertiser.domain}>
          <TableCell>
            <span className="grid min-w-0">
              <Inline as="span">
                <ClampText lines={1}>{advertiser.name}</ClampText>
                <AdOwnershipChip ownership={advertiser.ownership} />
              </Inline>
              <ClampText lines={1} className={textRole('caption', 'text-muted')}>
                {advertiser.domain}
              </ClampText>
            </span>
          </TableCell>
          <TableCell numeric>{advertiser.appearances}</TableCell>
          <TableCell numeric>{advertiser.prompts}</TableCell>
          <TableCell numeric>{formatPercent(advertiser.share)}</TableCell>
          <TableCell numeric>
            {formatDisplayShortDate(advertiser.first_seen_at, timeZone)} –{' '}
            {formatDisplayShortDate(advertiser.last_seen_at, timeZone)}
          </TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

const ADVERTISER_COLUMNS: readonly DataTableColumn[] = [
  { key: 'advertiser', label: 'Advertiser' },
  { key: 'appearances', label: 'Appearances', width: 'figure', numeric: true },
  { key: 'prompts', label: 'Prompts', width: 'figure', numeric: true },
  { key: 'share', label: 'Share', width: 'figure', numeric: true },
  { key: 'seen', label: 'Seen', width: 'date', numeric: true },
];

const PROMPT_COLUMNS: readonly DataTableColumn[] = [
  { key: 'prompt', label: 'Prompt' },
  { key: 'ads', label: 'Ads seen', width: 'figure', numeric: true },
  { key: 'top', label: 'Top advertiser', width: 'status' },
  { key: 'beside', label: 'You mentioned beside a competitor ad', width: 'name' },
];

function noAds(heading: string): DataTableState {
  return { kind: 'empty', headingLevel: 3, icon: Megaphone, heading };
}

function PromptTable({ prompts }: Readonly<{ prompts: VisibilityAdsResponse['prompts'] }>) {
  return (
    <DataTable
      title="Prompts that surface ads"
      columns={PROMPT_COLUMNS}
      footer="Where a competitor advertised, whether the answer also mentioned you organically. Counts only, not a cause."
      state={prompts.length ? undefined : noAds('No prompt surfaced an ad.')}
    >
      {prompts.map((row) => {
        const beside = row.competitor_ad_answers;
        const withCompetitorAd = beside.brand_mentioned + beside.brand_not_mentioned;
        return (
          <TableRow key={row.prompt}>
            <TableCell>{row.prompt}</TableCell>
            <TableCell numeric>{row.ads_seen}</TableCell>
            <TableCell>{row.top_advertiser?.name ?? <MissingValue />}</TableCell>
            <TableCell>
              {withCompetitorAd
                ? `${beside.brand_mentioned} of ${withCompetitorAd} answers`
                : 'No competitor ads'}
            </TableCell>
          </TableRow>
        );
      })}
    </DataTable>
  );
}

function CreativeList({
  creatives,
  onShowMore,
  loadingMore,
}: Readonly<{
  creatives: VisibilityAdsResponse['creatives'];
  onShowMore?: () => void;
  loadingMore: boolean;
}>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ad creatives</CardTitle>
        <CardDescription>
          {creatives.items.length < creatives.total
            ? `The ${creatives.items.length} most frequent of ${creatives.total} creatives, as text.`
            : 'The ads as text, with where they lead.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Stack>
          {!creatives.items.length ? (
            <QueryState kind="empty" inline message="No ads in these answers." />
          ) : (
            <Stack as="ul">
              {creatives.items.map((creative) => (
                <Stack
                  as="li"
                  gap="tight"
                  key={`${creative.advertiser_domain}:${creative.title}:${creative.snippet}:${creative.landing_url}`}
                >
                  <Inline as="span" className="flex-wrap">
                    <span className={textRole('emphasis')}>{creative.title || 'Untitled ad'}</span>
                    <AdOwnershipChip ownership={creative.ownership} />
                  </Inline>
                  {creative.snippet ? (
                    <span className={textRole('body', 'text-secondary')}>{creative.snippet}</span>
                  ) : null}
                  <span className={textRole('caption', 'text-muted')}>
                    {creative.advertiser_name} · {landingLabel(creative.landing_url)} ·{' '}
                    {pluralCount(creative.appearances, 'appearance')}
                  </span>
                </Stack>
              ))}
            </Stack>
          )}
          {onShowMore ? (
            <Button
              variant="secondary"
              className="justify-self-start"
              disabled={loadingMore}
              onClick={onShowMore}
            >
              Show more creatives
            </Button>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}
