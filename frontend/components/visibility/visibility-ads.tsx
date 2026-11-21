import type { VisibilityAdsResponse } from '@citeladder/contracts/visibility-ads';

import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import { ClampText } from '@/components/ui/clamp-text';
import { TableCell, TableCellLines, TableRow } from '@/components/ui/table';
import { textRole } from '@/components/ui/typography';
import { Absence } from '@/components/ui/absence';
import { Inline, Stack } from '@/components/ui/layout';
import { Megaphone } from '@/lib/icons';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatDisplayShortDate, formatPercent, pluralCount } from '@/lib/format';
import {
  AD_APPLICABILITY,
  adsStateHeading,
  landingLabel,
  presenceLine,
} from '@/lib/visibility/ads';
import { useEngineCatalog } from '@/lib/providers/engines';
import { mergedAdPages, useAds } from '@/lib/visibility/use-ads';
import { AdOwnershipChip } from '@/components/visibility/ad-ownership-chip';
import type { SourceFilters } from '@/components/visibility/source-rows';
import type { SourceQueries } from '@/lib/visibility/use-source-analysis';
import { AnalysisRead } from '@/components/visibility/selection-gate';
import { StateBlock } from '@/components/ui/state-block';
import { Section, SectionContent, TitledSection, SectionStack } from '@/components/ui/section';
import { FigureStrip } from '@/components/ui/figure-strip';

export function VisibilityAds({
  filters,
  queries,
}: Readonly<{ filters: SourceFilters; queries: SourceQueries }>) {
  const query = useAds(filters, queries);
  const [firstPage, ...laterPages] = query.data?.pages ?? [];
  return (
    <AnalysisRead
      query={query}
      title="Couldn't load the ads"
      busyLabel="Updating ads"
      busy={query.isFetching && !query.isFetchingNextPage}
      ready={firstPage}
    >
      {(page) => (
        <AdsView
          data={mergedAdPages([page, ...laterPages])}
          onShowMore={query.hasNextPage ? () => void query.fetchNextPage() : undefined}
          loadingMore={query.isFetchingNextPage}
        />
      )}
    </AnalysisRead>
  );
}

export function AdsView({
  data,
  onShowMore,
  loadingMore = false,
}: Readonly<{ data: VisibilityAdsResponse; onShowMore?: () => void; loadingMore?: boolean }>) {
  if (data.state !== 'value') return <AdsState state={data.state} engines={data.engines} />;
  return (
    <SectionStack>
      <Headline data={data} />
      <AdvertiserTable advertisers={data.advertisers} total={data.advertisers_seen} />
      <PromptTable prompts={data.prompts} />
      <CreativeList creatives={data.creatives} onShowMore={onShowMore} loadingMore={loadingMore} />
    </SectionStack>
  );
}

function AdsState({
  state,
  engines = [],
}: Readonly<{
  state: Exclude<VisibilityAdsResponse['state'], 'value'>;
  engines?: VisibilityAdsResponse['engines'];
}>) {
  const { label: engineLabel } = useEngineCatalog();
  const applicability = engines
    .map((engine) => `${engineLabel(engine.engine)}: ${AD_APPLICABILITY[engine.applicability]}`)
    .join(' · ');
  return (
    <StateBlock
      kind="empty"
      headingLevel={3}
      icon={Megaphone}
      heading={adsStateHeading(state)}
      description={applicability || undefined}
    />
  );
}

function EngineApplicability({ engines }: Readonly<{ engines: VisibilityAdsResponse['engines'] }>) {
  const { label: engineLabel } = useEngineCatalog();
  if (!engines.length) return null;
  return (
    <Inline as="ul" gap="meta" className={textRole('caption', 'text-ink-2')}>
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
    <Section>
      <SectionContent>
        <Stack gap="item">
          <FigureStrip
            label="Ads in ChatGPT answers"
            segments={[
              {
                key: 'presence',
                label: 'Ad presence',
                value: data.presence.rate === null ? null : formatPercent(data.presence.rate),
                missingState: 'unavailable',
                sub: presenceLine(data.presence),
              },
              {
                key: 'brand',
                label: 'Your ad share',
                value: formatPercent(data.brand.share),
                missingLabel: 'Not advertising',
                sub:
                  data.brand.best_rank === null
                    ? undefined
                    : `${data.brand.appearances} of your ads · best position ${data.brand.best_rank}`,
              },
              {
                key: 'advertisers',
                label: 'Advertisers seen',
                value: data.advertisers_seen,
              },
            ]}
          />
          <EngineApplicability engines={data.engines} />
        </Stack>
      </SectionContent>
    </Section>
  );
}

function AdvertiserTable({
  advertisers,
  total,
}: Readonly<{ advertisers: VisibilityAdsResponse['advertisers']; total: number }>) {
  const timeZone = useDisplayTimeZone();
  return (
    <TitledSection title="Advertisers">
      <DataTable
        label="Advertisers"
        columns={ADVERTISER_COLUMNS}
        footer={advertisers.length < total ? `Top ${advertisers.length} of ${total}` : undefined}
        state={advertisers.length ? undefined : noAds('No ads in these answers.')}
      >
        {advertisers.map((advertiser) => (
          <TableRow key={advertiser.domain}>
            <TableCell>
              <Inline as="span">
                <TableCellLines primary={advertiser.name} secondary={advertiser.domain} />
                <AdOwnershipChip ownership={advertiser.ownership} />
              </Inline>
            </TableCell>
            <TableCell numeric>{advertiser.appearances}</TableCell>
            <TableCell numeric>{advertiser.prompts}</TableCell>
            <TableCell numeric>{formatPercent(advertiser.share)}</TableCell>
            <TableCell>
              {formatDisplayShortDate(advertiser.first_seen_at, timeZone)} –{' '}
              {formatDisplayShortDate(advertiser.last_seen_at, timeZone)}
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
    </TitledSection>
  );
}

const ADVERTISER_COLUMNS: readonly DataTableColumn[] = [
  { key: 'advertiser', label: 'Advertiser' },
  { key: 'appearances', label: 'Appearances', width: 'figure', kind: 'number' },
  { key: 'prompts', label: 'Prompts', width: 'figure', kind: 'number' },
  { key: 'share', label: 'Share', width: 'figure', kind: 'number' },
  { key: 'seen', label: 'Seen', width: 'date' },
];

const PROMPT_COLUMNS: readonly DataTableColumn[] = [
  { key: 'prompt', label: 'Prompt' },
  { key: 'ads', label: 'Ads seen', width: 'figure', kind: 'number' },
  { key: 'top', label: 'Top advertiser', width: 'status' },
  {
    key: 'beside',
    label: 'Mentioned you',
    width: 'category',
    hint: 'Of the answers that showed a competitor ad, how many also mentioned you organically.',
  },
];

function noAds(heading: string): DataTableState {
  return { kind: 'empty', headingLevel: 3, icon: Megaphone, heading };
}

function PromptTable({ prompts }: Readonly<{ prompts: VisibilityAdsResponse['prompts'] }>) {
  return (
    <TitledSection title="Prompts that surface ads">
      <DataTable
        label="Prompts that surface ads"
        columns={PROMPT_COLUMNS}
        state={prompts.length ? undefined : noAds('No prompt surfaced an ad.')}
      >
        {prompts.map((row) => {
          const beside = row.competitor_ad_answers;
          const withCompetitorAd = beside.brand_mentioned + beside.brand_not_mentioned;
          return (
            <TableRow key={row.prompt}>
              <TableCell>{row.prompt}</TableCell>
              <TableCell numeric>{row.ads_seen}</TableCell>
              <TableCell>{row.top_advertiser?.name ?? <Absence />}</TableCell>
              <TableCell>
                {withCompetitorAd
                  ? `${beside.brand_mentioned} of ${withCompetitorAd} answers`
                  : 'No competitor ads'}
              </TableCell>
            </TableRow>
          );
        })}
      </DataTable>
    </TitledSection>
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
    <TitledSection
      title="Ad creatives"
      description={
        creatives.items.length < creatives.total
          ? `Top ${creatives.items.length} of ${creatives.total}`
          : undefined
      }
    >
      <SectionContent>
        <Stack>
          {!creatives.items.length ? (
            <StateBlock kind="empty" inline message="No ads in these answers." />
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
                    <span className={textRole('body', 'text-ink-2')}>{creative.snippet}</span>
                  ) : null}
                  <ClampText className={textRole('caption', 'text-ink-2')}>
                    {creative.advertiser_name} · {landingLabel(creative.landing_url)} ·{' '}
                    {pluralCount(creative.appearances, 'appearance')}
                  </ClampText>
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
      </SectionContent>
    </TitledSection>
  );
}
