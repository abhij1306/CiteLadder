import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { StatusMark } from '@/components/ui/status-mark';
import { Absence } from '@/components/ui/absence';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { TextLink } from '@/components/ui/text-link';
import { MastheadPrimary } from '@/components/ui/masthead-actions';
import { CrawlStatusBadge } from '@/components/site-health/crawl-status-badge';
import { RefreshCw } from '@/lib/icons';
import { followCatalogAnalysis } from '@/lib/api/commerce';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { siteHealthMutations, siteHealthQueries } from '@/lib/api/site-health-queries';
import { formatCount, pluralCount } from '@/lib/format';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import { crawlPollInterval } from '@/lib/site-health/status';

import type { SiteCrawl } from '@citeladder/contracts';
import type { CommerceProjection } from '@citeladder/contracts/commerce-suite';

import { AddProductsDialog } from './add-products-dialog';
import type { CommerceQueries } from './commerce-queries';
import { Notice } from '@/components/ui/notice';
import { FigureStrip, type FigureSegment } from '@/components/ui/figure-strip';

type CrawlRead =
  | Readonly<{ kind: 'pending' }>
  | Readonly<{ kind: 'failed' }>
  | Readonly<{ kind: 'answered'; crawl: SiteCrawl | null }>;

function crawlRead(dashboard: {
  data: { crawl?: SiteCrawl | null } | undefined;
  isError: boolean;
}): CrawlRead {
  if (dashboard.isError) return { kind: 'failed' };
  if (dashboard.data) return { kind: 'answered', crawl: dashboard.data.crawl ?? null };
  return { kind: 'pending' };
}

function analyzedLabel(crawl: SiteCrawl): string {
  const known = crawl.total_url_count ?? crawl.visible_url_count;
  return `${crawl.analyzed_count}/${Math.max(known, crawl.analyzed_count)}`;
}

function crawlSegments(read: CrawlRead): FigureSegment[] {
  if (read.kind !== 'answered') {
    const loading = read.kind === 'pending';
    const missingState = loading ? undefined : ('unavailable' as const);
    return [
      { key: 'analyzed', label: 'Pages analyzed', value: null, loading, missingState },
      { key: 'site-health', label: 'Site health', value: null, loading, missingState },
    ];
  }
  const { crawl } = read;
  return [
    {
      key: 'analyzed',
      label: 'Pages analyzed',
      value: crawl ? analyzedLabel(crawl) : null,
      missingState: 'not_run',
    },
    {
      key: 'site-health',
      label: 'Site health',
      value: crawl ? <CrawlStatusBadge crawl={crawl} /> : null,
      missingState: 'not_run',
    },
  ];
}

function projectionBadge(projection: CommerceProjection | undefined) {
  if (!projection) return null;
  if (projection.in_flight)
    return (
      <StatusMark variant="status" value="info">
        {projection.in_flight} projecting
      </StatusMark>
    );
  if (projection.failed)
    return (
      <StatusMark variant="status" value="danger">
        {pluralCount(projection.failed, 'page')} not projected
      </StatusMark>
    );
  if (projection.applicability === 'not_applicable') return <Absence state="not_applicable" />;
  return null;
}

function CatalogStats({
  catalog,
  projection,
  crawl,
}: Readonly<{
  catalog: CommerceQueries['catalog'];
  projection: CommerceProjection | undefined;
  crawl: CrawlRead;
}>) {
  const missing = {
    loading: catalog.isPending,
    missingState: catalog.isError ? ('unavailable' as const) : undefined,
  };
  const counts = catalog.data;
  const items: FigureSegment[] = [
    {
      key: 'products',
      label: 'Products',
      value: counts ? formatCount(counts.product_total) : null,
      ...missing,
    },
    {
      key: 'categories',
      label: 'Categories',
      value: counts ? formatCount(counts.categories.length) : null,
      ...missing,
    },
    ...crawlSegments(crawl),
  ];
  const badge = projectionBadge(projection);
  if (badge) items.push({ key: 'projection', label: 'Projection', value: badge });
  return <FigureStrip segments={items} />;
}

export function useCatalogHeader({
  workspaceId,
  projectId,
  query,
  projection,
  tableReadFailed = false,
}: Readonly<{
  workspaceId: string;
  projectId: string;
  query: CommerceQueries['catalog'];
  projection: CommerceProjection | undefined;
  tableReadFailed?: boolean;
}>) {
  const client = useQueryClient();
  const dashboard = useQuery({
    ...siteHealthQueries.dashboard({ workspaceId, projectId }),
    refetchInterval: (state) => {
      const crawl = state.state.data?.crawl;
      return crawl ? crawlPollInterval(crawl) : false;
    },
  });
  const analyzed = dashboard.data?.crawl?.analyzed_count;
  const catalogReadAt = query.dataUpdatedAt;
  const hasCatalog = query.data !== undefined;
  useEffect(() => {
    if (analyzed === undefined || !hasCatalog) return;
    followCatalogAnalysis(client, { workspaceId, projectId }, { readAt: catalogReadAt, analyzed });
  }, [analyzed, catalogReadAt, hasCatalog, client, workspaceId, projectId]);
  const [adding, setAdding] = useState(false);
  const discover = useMutation(siteHealthMutations.createCrawl(workspaceId));
  const startDiscovery = () =>
    discover.mutate({ project_id: projectId }, { onSuccess: () => void query.refetch() });
  const crawl = crawlRead(dashboard);
  const noCrawl = crawl.kind === 'answered' && crawl.crawl === null;
  const refresh = () =>
    noCrawl ? startDiscovery() : void Promise.all([dashboard.refetch(), query.refetch()]);
  const canRun = useWorkspaceCapability('run');
  const refreshBusy = discover.isPending || dashboard.isPending;
  const refreshLabel = noCrawl ? 'Run Site health crawl' : 'Refresh from Site health';
  const dialog = canRun ? (
    <AddProductsDialog
      workspaceId={workspaceId}
      projectId={projectId}
      open={adding}
      onOpenChange={setAdding}
    />
  ) : null;
  const refreshNotice = (
    <CatalogNotices
      refreshError={discover.error ?? (tableReadFailed ? null : dashboard.error)}
      onRefresh={refresh}
    />
  );
  return {
    retryReads: () => void Promise.all([dashboard.refetch(), query.refetch()]),
    actions: (
      <>
        {canRun ? (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Add products
          </Button>
        ) : null}
        {canRun || !noCrawl ? (
          <MastheadPrimary>
            <Button variant="primary" disabled={refreshBusy} onClick={refresh}>
              {refreshLabel}
            </Button>
          </MastheadPrimary>
        ) : null}
        {dialog}
      </>
    ),
    empty: {
      dialog,
      actions: canRun ? (
        <>
          <Button onClick={() => setAdding(true)}>Add products</Button>
          <Button variant="quiet" disabled={refreshBusy} onClick={refresh}>
            <Icon icon={RefreshCw} />
            {refreshLabel}
          </Button>
        </>
      ) : null,
      notices: refreshNotice,
      businessModelUnconfirmed: businessModelUnconfirmed(projection),
    },
    stats: <CatalogStats catalog={query} projection={projection} crawl={crawl} />,
    notices: (
      <>
        {refreshNotice}
        {businessModelUnconfirmed(projection) ? (
          <Notice tone="warning" title="Business model unconfirmed">
            Pages from the Site health crawl become catalog products once your business model is
            confirmed as one that sells products. <ConfirmBusinessModelLink />
          </Notice>
        ) : null}
      </>
    ),
  };
}

function businessModelUnconfirmed(projection: CommerceProjection | undefined): boolean {
  return projection?.applicability === 'unknown' && !projection.in_flight && !projection.failed;
}

export function ConfirmBusinessModelLink() {
  return (
    <TextLink href="/agent/context?tab=map" text="inherit">
      Confirm your business model in Context
    </TextLink>
  );
}

function CatalogNotices({
  refreshError,
  onRefresh,
}: Readonly<{
  refreshError: unknown;
  onRefresh: () => void;
}>) {
  if (!refreshError) return null;
  return (
    <Notice
      kind="mutation"
      notice={mutationNoticeForError(refreshError, {
        action: 'refresh Site health progress',
      })}
      recovery={
        <Button type="button" variant="secondary" onClick={onRefresh}>
          Refresh again
        </Button>
      }
    />
  );
}
