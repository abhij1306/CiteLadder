'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CrawlStatusBadge } from '@/components/site-health/crawl-status-badge';
import { CsvImportTrigger } from '@/components/ui/csv-import';
import { Stack } from '@/components/ui/layout';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { KpiRow, type StatSegment } from '@/components/ui/stat-row';
import { textRole } from '@/components/ui/typography';
import { commerceMutations, followCatalogAnalysis } from '@/lib/api/commerce';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { siteHealthMutations, siteHealthQueries } from '@/lib/api/site-health-queries';
import { pluralCount } from '@/lib/format';
import { crawlPollInterval } from '@/lib/site-health/status';

import type { SiteCrawl } from '@citeladder/contracts';
import type { CommerceProjection } from '@citeladder/contracts/commerce-suite';

import type { CommerceQueries } from './commerce-queries';

/**
 * Pages analyzed over the crawl's own inventory.
 *
 * The denominator is the site inventory the crawl holds, which is never below
 * what it analyzed — reading it off the discovery FETCH counter is what
 * rendered "49/1". The client still floors it, because a crawl whose counters
 * are mid-flight must not print a fraction that reads backwards.
 */
/** The dashboard's crawl, exactly as the query returns it (nullable). */
type SiteHealthCrawl = SiteCrawl | null;

function analyzedLabel(crawl: SiteHealthCrawl): string | null {
  if (!crawl) return null;
  const known = crawl.total_url_count ?? crawl.visible_url_count;
  return `${crawl.analyzed_count}/${Math.max(known, crawl.analyzed_count)}`;
}

/**
 * Pages still being turned into catalog rows, then pages of the latest crawl
 * that could not be. When crawls do not project at all, it says whether the
 * business does not sell a catalog or its model is not confirmed yet. A
 * finished, clean projection shows nothing.
 */
function projectionBadge(projection: CommerceProjection | undefined) {
  if (!projection) return null;
  if (projection.in_flight)
    return (
      <Badge variant="status" value="info">
        {projection.in_flight} projecting
      </Badge>
    );
  if (projection.failed)
    return (
      <Badge variant="status" value="danger">
        {pluralCount(projection.failed, 'page')} not projected
      </Badge>
    );
  if (projection.applicability === 'not_applicable') return <Badge>Not applicable</Badge>;
  if (projection.applicability === 'unknown') return <Badge>Business model unconfirmed</Badge>;
  return null;
}

/** The catalog-wide metrics half of the toolbar: counts, crawl, queue. */
function CatalogStats({
  counts,
  projection,
  crawl,
}: Readonly<{
  counts: CommerceQueries['catalog']['data'];
  projection: CommerceProjection | undefined;
  crawl: SiteHealthCrawl;
}>) {
  const items: StatSegment[] = [
    {
      key: 'products',
      label: 'Products',
      value: counts ? `${counts.product_total}` : null,
    },
    {
      key: 'categories',
      label: 'Categories',
      value: counts ? `${counts.categories.length}` : null,
    },
    { key: 'analyzed', label: 'Pages analyzed', value: analyzedLabel(crawl) },
    {
      key: 'site-health',
      label: 'Site Health',
      value: crawl ? <CrawlStatusBadge crawl={crawl} /> : <Badge>No crawl yet</Badge>,
    },
  ];
  const badge = projectionBadge(projection);
  if (badge) items.push({ key: 'projection', label: 'Projection', value: badge });
  return <KpiRow segments={items} />;
}

/**
 * Catalog-WIDE state and catalog-wide actions, and nothing target-scoped.
 *
 * It used to be a `<Card>` holding both halves — the only toolbar in the app
 * boxed in one, which is exactly the inconsistency the page grammar removes.
 * The two halves now go where the grammar puts them: the actions are route
 * actions and belong to the identity band, the counts are evidence and belong
 * at the top of the content region. So this is a hook that owns the mutations
 * once and hands back the pieces, rather than a component that has to render
 * them side by side to keep them together.
 */
export function useCatalogHeader({
  workspaceId,
  projectId,
  query,
  projection,
}: Readonly<{
  workspaceId: string;
  projectId: string;
  query: CommerceQueries['catalog'];
  /** The newest projection progress known (`useCatalogProjection`). */
  projection: CommerceProjection | undefined;
}>) {
  const client = useQueryClient();
  const [result, setResult] = useState('');
  const dashboard = useQuery({
    ...siteHealthQueries.dashboard({ workspaceId, projectId }),
    refetchInterval: (state) => {
      const crawl = state.state.data?.crawl;
      return crawl ? crawlPollInterval(crawl) : false;
    },
  });
  // A running crawl enqueues projections as pages are analyzed; re-read the
  // catalog when that count has moved past the one its cached read was taken
  // beside, so its own polling starts with the first task.
  const analyzed = dashboard.data?.crawl?.analyzed_count;
  const catalogReadAt = query.dataUpdatedAt;
  const hasCatalog = query.data !== undefined;
  useEffect(() => {
    if (analyzed === undefined || !hasCatalog) return;
    followCatalogAnalysis(client, { workspaceId, projectId }, { readAt: catalogReadAt, analyzed });
  }, [analyzed, catalogReadAt, hasCatalog, client, workspaceId, projectId]);
  const importCatalog = useMutation(commerceMutations.importCatalog({ workspaceId, projectId }));
  const importFile = (file: File) =>
    importCatalog.mutate(file, {
      onSuccess: (data) =>
        setResult(
          `${data.created} created, ${data.updated} updated, ${data.unchanged} unchanged, ${data.rejected} rejected`,
        ),
    });
  // The descriptor refreshes the Site Health dashboard; the catalog is this screen's own read.
  const discover = useMutation(siteHealthMutations.createCrawl(workspaceId));
  const startDiscovery = () =>
    discover.mutate({ project_id: projectId }, { onSuccess: () => void query.refetch() });
  const crawl = dashboard.data?.crawl ?? null;
  const counts = query.data;
  const refresh = () =>
    crawl ? void Promise.all([dashboard.refetch(), query.refetch()]) : startDiscovery();
  return {
    actions: (
      <CatalogActions
        crawl={crawl}
        importing={importCatalog.isPending}
        onImport={importFile}
        refreshing={discover.isPending || dashboard.isPending}
        onRefresh={refresh}
      />
    ),
    stats: <CatalogStats counts={counts} projection={projection} crawl={crawl} />,
    notices: (
      <CatalogNotices
        result={result}
        importError={importCatalog.error}
        refreshError={discover.error ?? dashboard.error}
        onRefresh={refresh}
      />
    ),
  };
}

/** The catalog's route actions, for the identity band. */
function CatalogActions({
  crawl,
  importing,
  onImport,
  refreshing,
  onRefresh,
}: Readonly<{
  crawl: SiteHealthCrawl;
  importing: boolean;
  onImport: (file: File) => void;
  refreshing: boolean;
  onRefresh: () => void;
}>) {
  return (
    <>
      <CsvImportTrigger
        accessibleLabel="Import catalog CSV"
        pending={importing}
        onSelect={onImport}
      />
      <Button variant="primary" disabled={refreshing} onClick={onRefresh}>
        {crawl ? 'Refresh from Site Health' : 'Run Site Health crawl'}
      </Button>
    </>
  );
}

/** Whatever the last catalog-wide action has to report, above the counts. */
function CatalogNotices({
  result,
  importError,
  refreshError,
  onRefresh,
}: Readonly<{
  result: string;
  importError: unknown;
  refreshError: unknown;
  /** Re-runs the refresh, the recovery for a failed one. */
  onRefresh: () => void;
}>) {
  if (!result && !importError && !refreshError) return null;
  return (
    <Stack>
      {result ? <p className={textRole('body')}>{result}</p> : null}
      {importError ? (
        <MutationNotice
          notice={mutationNoticeForError(importError, { action: 'import the catalog' })}
        />
      ) : null}
      {refreshError ? (
        <MutationNotice
          notice={mutationNoticeForError(refreshError, {
            action: 'refresh Site Health progress',
          })}
          recovery={
            <Button type="button" variant="secondary" onClick={onRefresh}>
              Refresh again
            </Button>
          }
        />
      ) : null}
    </Stack>
  );
}
