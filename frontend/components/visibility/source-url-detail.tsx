'use client';

import { BrandLogo } from '@/components/ui/brand-logo';
import { BusyBar } from '@/components/ui/busy-bar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ReadError } from '@/components/ui/read-error';
import { StatGrid } from '@/components/ui/stat-grid';
import { TextLink } from '@/components/ui/text-link';
import { splitPaneClasses } from '@/components/ui/workspace';
import { SourceBreadcrumb } from '@/components/visibility/source-breadcrumb';
import { SourcePrompts } from '@/components/visibility/source-prompts';
import type { SourceFilters } from '@/components/visibility/source-rows';
import { UsageCard } from '@/components/visibility/source-charts';
import { BrandsCard, EnginesCard } from '@/components/visibility/source-url-cards';
import { SourceUrlPageCard } from '@/components/visibility/source-url-page';
import { count, hostOf, pathOf, ratio, sinceLabel } from '@/lib/visibility/sources';
import {
  useSourceSeries,
  useSourceUrl,
  type SourceQueries,
} from '@/lib/visibility/use-source-analysis';

/**
 * One cited URL: whether there is something to do about it, what is on it,
 * how engines use it over time, and the answers that used it.
 *
 * Every figure here is scoped to the selection above it, including First seen —
 * which is the earliest sighting in the period being looked at, not the page's
 * age. The label says "in this period" for that reason: a reader who narrows
 * to thirty days and sees the date move would otherwise conclude the page had
 * been republished.
 */
export function SourceUrlDetail({
  url,
  domain,
  filters,
  queries,
  onBack,
  onOpenInventory,
}: Readonly<{
  url: string;
  domain: string | null;
  filters: SourceFilters;
  queries: SourceQueries;
  /** Up one level: the domain's page when opened from it, else the inventory. */
  onBack: () => void;
  /** All the way out to the Domains / URLs inventory. */
  onOpenInventory: () => void;
}>) {
  const query = useSourceUrl(filters, queries, url);
  const usage = useSourceSeries(filters, queries, {
    dimension: 'url',
    domain: null,
    sourceType: null,
    url,
  });
  const data = query.data;
  const title = data?.title?.trim() || pathOf(url);

  return (
    <div className="grid gap-[var(--workspace-gap)]">
      <SourceBreadcrumb
        // Two crumbs, two destinations. Both calling `onBack` meant clicking
        // "Sources" from a URL opened inside a domain landed on that domain.
        trail={[
          { label: 'Sources', onClick: onOpenInventory },
          ...(domain ? [{ label: domain, onClick: onBack }] : []),
        ]}
        current={title}
      />

      <Card className="relative" aria-busy={query.isFetching}>
        <BusyBar active={query.isFetching} label="Updating source" />
        <PageIdentity title={title} url={url} />
        <CardContent>
          {query.isError ? (
            <ReadError
              error={query.error}
              fallback="Could not load this source."
              onRetry={() => void query.refetch()}
              pending={query.isFetching}
            />
          ) : null}
          {query.isLoading ? <Skeleton className="h-20 w-full" /> : null}
          {data ? <Overview data={data} /> : null}
        </CardContent>
      </Card>

      <SourceUrlPageCard url={url} page={data?.page} loading={query.isLoading} />

      <UsageCard
        dimension="url"
        query={usage}
        heading={{
          title: 'Use over time',
          description:
            'How often answers used this page as a source, as a share of the answers in each period.',
        }}
      />

      <div className={splitPaneClasses('peers')}>
        <EnginesCard engines={data?.engines} loading={query.isLoading} errored={query.isError} />
        <BrandsCard brands={data?.brands} loading={query.isLoading} errored={query.isError} />
      </div>

      <SourcePrompts filters={filters} queries={queries} url={url} />
    </div>
  );
}

/** The page's mark, its title and the live link to it. */
function PageIdentity({ title, url }: Readonly<{ title: string; url: string }>) {
  const host = hostOf(url);
  return (
    <CardHeader>
      <div className="flex min-w-0 items-start gap-3">
        <BrandLogo name={host ?? url} websiteUrl={host ? `https://${host}` : null} size="lg" />
        <div className="grid min-w-0 gap-1">
          <CardTitle className="truncate">{title}</CardTitle>
          {/* An unsafe cited URL renders as plain text rather than a link. */}
          <TextLink variant="external" text="caption" href={url} className="min-w-0">
            <span className="truncate">{url}</span>
          </TextLink>
        </div>
      </div>
    </CardHeader>
  );
}

function Overview({
  data,
}: Readonly<{ data: NonNullable<ReturnType<typeof useSourceUrl>['data']> }>) {
  return (
    <StatGrid
      columns={3}
      size="figure"
      items={[
        { key: 'citation-rate', label: 'Citation rate', value: ratio(data.citation_rate) },
        { key: 'retrievals', label: 'Retrievals', value: count(data.retrievals) },
        { key: 'citations', label: 'Citations', value: count(data.citations) },
        { key: 'prompts', label: 'Prompts using it', value: count(data.prompts) },
        {
          key: 'first-seen',
          label: 'First seen in this period',
          value: sinceLabel(data.first_seen),
        },
        { key: 'last-seen', label: 'Last seen', value: sinceLabel(data.last_seen) },
      ]}
    />
  );
}
