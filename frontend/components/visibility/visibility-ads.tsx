'use client';

import type { VisibilityAdsResponse } from '@citeladder/contracts/visibility-ads';
import { Megaphone } from 'lucide-react';

import { BusyBar } from '@/components/ui/busy-bar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { ReadError } from '@/components/ui/read-error';
import { Skeleton } from '@/components/ui/skeleton';
import { StatGrid } from '@/components/ui/stat-grid';
import {
  ClampText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { textRole } from '@/components/ui/typography';
import { MissingValue } from '@/components/ui/unavailable-value';
import { Stack } from '@/components/ui/layout';
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
      <Skeleton className="h-28" />
      <Skeleton className="h-64" />
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
      <CardContent className="grid gap-2">
        <EmptyState
          variant="compact"
          icon={Megaphone}
          heading={copy.heading}
          description={copy.description}
        />
        <EngineApplicability engines={engines} />
      </CardContent>
    </Card>
  );
}

function EngineApplicability({ engines }: Readonly<{ engines: VisibilityAdsResponse['engines'] }>) {
  if (!engines.length) return null;
  return (
    <ul className={textRole('caption', 'text-muted flex flex-wrap gap-x-4 gap-y-1')}>
      {engines.map((engine) => (
        <li key={engine.engine}>
          {engineLabel(engine.engine)}: {AD_APPLICABILITY[engine.applicability]}
        </li>
      ))}
    </ul>
  );
}

function Headline({ data }: Readonly<{ data: VisibilityAdsResponse }>) {
  return (
    <Card>
      <CardContent className="grid gap-2">
        <StatGrid
          surface="well"
          columns={3}
          label="Ads in ChatGPT answers"
          items={[
            {
              key: 'presence',
              label: 'Ad presence',
              value: measured(formatPercent(data.presence.rate)),
              missingLabel: 'Unavailable',
              detail: presenceLine(data.presence),
            },
            {
              key: 'brand',
              label: 'Your ad share',
              value: measured(formatPercent(data.brand.share)),
              missingLabel: 'Not advertising',
              detail:
                data.brand.best_rank === null
                  ? 'No ads of yours were seen.'
                  : `${data.brand.appearances} of your ads; best position ${data.brand.best_rank}`,
            },
            {
              key: 'advertisers',
              label: 'Advertisers seen',
              value: data.advertisers_seen,
              detail: 'Distinct advertiser domains in these answers.',
            },
          ]}
        />
        <EngineApplicability engines={data.engines} />
        <CoverageNote />
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
    <Card>
      <CardHeader>
        <CardTitle>Advertisers</CardTitle>
        <CardDescription>
          {advertisers.length < total
            ? `The ${advertisers.length} most frequent of ${total} advertisers.`
            : 'Who paid to appear in these answers.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {!advertisers.length ? (
          <InlineEmpty className="p-[var(--card-padding)]">No ads in these answers.</InlineEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Advertiser</TableHead>
                <TableHead numeric>Appearances</TableHead>
                <TableHead numeric>Prompts</TableHead>
                <TableHead numeric>Share</TableHead>
                <TableHead numeric>Seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {advertisers.map((advertiser) => (
                <TableRow key={advertiser.domain}>
                  <TableCell>
                    <span className="grid min-w-0">
                      <span className="flex min-w-0 items-center gap-2">
                        <ClampText lines={1}>{advertiser.name}</ClampText>
                        <AdOwnershipChip ownership={advertiser.ownership} />
                      </span>
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
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function PromptTable({ prompts }: Readonly<{ prompts: VisibilityAdsResponse['prompts'] }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Prompts that surface ads</CardTitle>
        <CardDescription>
          Where a competitor advertised, whether the answer also mentioned you organically. Counts
          only, not a cause.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {!prompts.length ? (
          <InlineEmpty className="p-[var(--card-padding)]">No prompt surfaced an ad.</InlineEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Prompt</TableHead>
                <TableHead numeric>Ads seen</TableHead>
                <TableHead>Top advertiser</TableHead>
                <TableHead>You mentioned beside a competitor ad</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
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
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
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
      <CardContent className="grid gap-3">
        {!creatives.items.length ? (
          <InlineEmpty>No ads in these answers.</InlineEmpty>
        ) : (
          <ul className="grid gap-3">
            {creatives.items.map((creative) => (
              <li
                key={`${creative.advertiser_domain}:${creative.title}:${creative.snippet}:${creative.landing_url}`}
                className="grid gap-1"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className={textRole('emphasis')}>{creative.title || 'Untitled ad'}</span>
                  <AdOwnershipChip ownership={creative.ownership} />
                </span>
                {creative.snippet ? (
                  <span className={textRole('body', 'text-secondary')}>{creative.snippet}</span>
                ) : null}
                <span className={textRole('caption', 'text-muted')}>
                  {creative.advertiser_name} · {landingLabel(creative.landing_url)} ·{' '}
                  {pluralCount(creative.appearances, 'appearance')}
                </span>
              </li>
            ))}
          </ul>
        )}
        {onShowMore ? (
          <Button
            variant="secondary"
            size="sm"
            className="justify-self-start"
            disabled={loadingMore}
            onClick={onShowMore}
          >
            Show more creatives
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
