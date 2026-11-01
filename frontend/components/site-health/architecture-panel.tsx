'use client';

import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Link2, ListTree } from 'lucide-react';

import { HierarchyCard } from '@/components/site-health/architecture-hierarchy';
import {
  ORPHAN_SCOPE_NOTE,
  OrphanPageDrawer,
  orphanSegment,
} from '@/components/site-health/architecture-orphans';
import { PageKindBadge } from '@/components/site-health/page-kind-badge';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { MeterRow } from '@/components/ui/meter';
import { Pressable } from '@/components/ui/pressable';
import { QueryState } from '@/components/ui/query-state';
import { StatRow } from '@/components/ui/stat-row';
import { TextLink } from '@/components/ui/text-link';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { splitPaneClasses } from '@/components/ui/workspace';
import { siteHealthQueries } from '@/lib/api/site-health';
import type {
  ArchitectureNode,
  ArchitecturePageKind,
  CoverageState,
  SiteArchitecture,
} from '@/lib/api/types';
import { PLACEHOLDER } from '@/lib/site-health/status';

const COVERAGE_LABELS: Record<CoverageState, string> = {
  complete: 'Complete coverage',
  partial: 'Partial coverage',
  unknown: 'Coverage unknown',
};

// The tokens `assess_coverage` freezes onto the crawl. Naming a coverage state
// without naming its cause leaves the reader with a caveat they cannot act on.
const COVERAGE_REASON_LABELS: Record<string, string> = {
  requested_page_limit_reached: 'the crawl reached the page limit it was given',
  frontier_limit_reached: 'the crawl reached its maximum queue size',
  frontier_not_exhausted: 'the crawl finished with URLs still queued',
  discovery_bounded_or_stopped: 'discovery was bounded or stopped early',
  discovery_failed: 'a discovery request failed',
  no_observed_urls: 'no URLs were observed',
  discovery_not_completed: 'discovery did not finish',
  frontier_exhausted: 'the crawl emptied its discovery queue',
};

const DEPTH_LABELS = {
  depth_0: 'Depth 0',
  depth_1: 'Depth 1',
  depth_2: 'Depth 2',
  depth_3_plus: 'Depth 3+',
} as const;

function formatPercentage(value: number | null): string {
  return value === null ? PLACEHOLDER : `${Math.round(value * 100)}%`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

export function ArchitecturePanel({
  workspaceId,
  projectId,
  crawlId,
}: Readonly<{ workspaceId: string; projectId: string; crawlId?: string }>) {
  const architecture = useQuery(siteHealthQueries.architecture(workspaceId, projectId, crawlId));

  if (architecture.isLoading) {
    return <QueryState kind="loading" label="Loading the observed architecture" />;
  }
  if (architecture.isError)
    return (
      <QueryState
        kind="error"
        error={architecture.error}
        fallback="Could not load Architecture."
        onRetry={() => void architecture.refetch()}
        pending={architecture.isFetching}
      />
    );
  if (!architecture.data || architecture.data.state === 'unavailable') {
    return (
      <Alert tone="info">
        {architecture.data?.limitations[0] ??
          'Page kinds appear once a crawl has finished and its structure has been derived.'}
      </Alert>
    );
  }
  return <ArchitectureLedger data={architecture.data} />;
}

function pagesByKind(nodes: ArchitectureNode[]): Map<string, ArchitectureNode[]> {
  const grouped = new Map<string, ArchitectureNode[]>();
  for (const node of nodes) {
    const pages = grouped.get(node.page_kind);
    if (pages) pages.push(node);
    else grouped.set(node.page_kind, [node]);
  }
  for (const pages of grouped.values()) {
    pages.sort((left, right) => left.url.localeCompare(right.url));
  }
  return grouped;
}

function ArchitectureLedger({ data }: Readonly<{ data: SiteArchitecture }>) {
  const grouped = useMemo(() => pagesByKind(data.nodes), [data.nodes]);
  const pageKinds = useMemo(
    () => [...data.page_kinds].sort((left, right) => right.page_count - left.page_count),
    [data.page_kinds],
  );
  const depths = data.nodes.flatMap((node) =>
    node.depth_from_home === null ? [] : [node.depth_from_home],
  );
  const duplicatePages = pageKinds.reduce(
    (total, pageKind) => total + pageKind.duplicate_metadata_count,
    0,
  );

  return (
    <Stack gap="workspace" className="min-w-0" data-testid="site-architecture">
      <ArchitectureEvidence data={data} />
      <Card>
        <CardHeader
          actions={
            <Badge
              variant="status"
              value={data.coverage_state === 'complete' ? 'success' : 'warning'}
            >
              {COVERAGE_LABELS[data.coverage_state]}
            </Badge>
          }
        >
          <CardTitle>Page kinds</CardTitle>
          <CardDescription>
            URLs grouped by their persisted structural purpose for this crawl.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Stack>
            <ArchitectureMetrics
              pageKinds={pageKinds.length}
              pages={data.page_count}
              medianDepth={median(depths)}
              duplicatePages={duplicatePages}
              orphanCount={data.internal_linking.orphan_page_count}
            />
            <CoverageReasons reasons={data.coverage_reasons} />
            {pageKinds.length === 0 ? (
              <QueryState kind="empty" inline message="No page kinds were measured." />
            ) : null}
          </Stack>
        </CardContent>
      </Card>
      {pageKinds.length === 0 ? null : (
        <PageKindTable pageKinds={pageKinds} grouped={grouped} crawlId={data.crawl_id} />
      )}
      <HierarchyCard nodes={data.nodes} crawlId={data.crawl_id} />
    </Stack>
  );
}

function CoverageReasons({ reasons }: Readonly<{ reasons: readonly string[] }>) {
  const named = reasons.filter((reason) => reason in COVERAGE_REASON_LABELS);
  if (named.length === 0) return null;
  return (
    <p className="type-caption">
      Why: {named.map((reason) => COVERAGE_REASON_LABELS[reason]).join('; ')}.
    </p>
  );
}

function ArchitectureMetrics({
  pageKinds,
  pages,
  medianDepth,
  duplicatePages,
  orphanCount,
}: Readonly<{
  pageKinds: number;
  pages: number;
  medianDepth: number | null;
  duplicatePages: number;
  orphanCount: number | null;
}>) {
  const items: readonly (readonly [string, string, string?])[] = [
    ['Page kinds', String(pageKinds)],
    ['Pages', String(pages)],
    ['Median depth', medianDepth === null ? PLACEHOLDER : String(medianDepth)],
    ['Duplicate metadata', String(duplicatePages)],
    [
      'Orphaned pages',
      orphanCount === null ? PLACEHOLDER : String(orphanCount),
      orphanCount === null ? undefined : ORPHAN_SCOPE_NOTE,
    ],
  ];
  return (
    <StatRow
      segments={items.map(([label, value, supporting]) => ({
        key: label,
        label,
        value: value === PLACEHOLDER ? <UnavailableValue state="not_measured" /> : value,
        sub: supporting,
      }))}
    />
  );
}

function PageKindTable({
  pageKinds,
  grouped,
  crawlId,
}: Readonly<{
  pageKinds: ArchitecturePageKind[];
  grouped: Map<string, ArchitectureNode[]>;
  crawlId: string | null;
}>) {
  const [openKind, setOpenKind] = useState<string | null>(null);
  return (
    <DataTable label="Page kinds" columns={PAGE_KIND_COLUMNS} minWidth="md">
      {pageKinds.map((pageKind) => {
        const open = openKind === pageKind.page_kind;
        const pages = grouped.get(pageKind.page_kind) ?? [];
        return (
          <Fragment key={pageKind.page_kind}>
            <TableRow>
              <TableCell>
                <Pressable
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenKind(open ? null : pageKind.page_kind)}
                  className="w-auto"
                >
                  <Inline as="span">
                    <Icon icon={open ? ChevronDown : ChevronRight} className="text-muted" />
                    <PageKindBadge pageKind={pageKind.page_kind} />
                  </Inline>
                </Pressable>
              </TableCell>
              <TableCell numeric>{pageKind.page_count}</TableCell>
              <TableCell numeric>
                {pageKind.median_depth ?? <UnavailableValue state="not_measured" />}
              </TableCell>
              <TableCell numeric>
                {pageKind.indexable_count} / {pageKind.page_count}
              </TableCell>
              <TableCell numeric>{pageKind.duplicate_metadata_count}</TableCell>
              <TableCell numeric>
                {pageKind.orphan_count ?? <UnavailableValue state="not_measured" />}
              </TableCell>
            </TableRow>
            {open ? <PageKindPages pages={pages} crawlId={crawlId} /> : null}
          </Fragment>
        );
      })}
    </DataTable>
  );
}

const PAGE_KIND_COLUMNS: readonly DataTableColumn[] = [
  { key: 'kind', label: 'Page kind' },
  { key: 'pages', label: 'Pages', width: 'figure', numeric: true },
  { key: 'depth', label: 'Median depth', width: 'figure', numeric: true },
  { key: 'indexable', label: 'Indexable', width: 'figure', numeric: true },
  { key: 'duplicates', label: 'Duplicate metadata', width: 'figure', numeric: true },
  { key: 'orphaned', label: 'Orphaned', width: 'figure', numeric: true },
];

function PageKindPages({
  pages,
  crawlId,
}: Readonly<{ pages: ArchitectureNode[]; crawlId: string | null }>) {
  return (
    <TableRow className="bg-panel-tonal hover:bg-panel-tonal">
      <TableCell colSpan={6}>
        {pages.length === 0 ? (
          <QueryState
            kind="empty"
            inline
            message="No projected URLs are available for this kind."
          />
        ) : (
          <Stack
            as="ul"
            gap="item"
            className="content-scroll max-h-64 overflow-y-auto overscroll-contain"
          >
            {pages.map((page) => (
              <li key={page.site_url_id} className="min-w-0">
                {crawlId ? (
                  <TextLink
                    text="body"
                    className="block min-w-0"
                    href={`/site/crawls/${crawlId}/pages/${page.site_url_id}`}
                  >
                    <ClampText lines={1}>{page.url}</ClampText>
                  </TextLink>
                ) : (
                  <ClampText lines={1} className="type-body text-foreground">
                    {page.url}
                  </ClampText>
                )}
              </li>
            ))}
          </Stack>
        )}
      </TableCell>
    </TableRow>
  );
}

function ArchitectureEvidence({ data }: Readonly<{ data: SiteArchitecture }>) {
  const linking = data.internal_linking;
  const [orphansOpen, setOrphansOpen] = useState(false);
  const linkedShare = linking.pages_with_incoming_percentage;
  return (
    <>
      <div className={splitPaneClasses('peers')}>
        <Card>
          <CardHeader>
            <CardTitle>
              <Inline as="span">
                <Icon icon={Link2} className="text-muted" />
                Internal linking
              </Inline>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StatRow
              segments={[
                {
                  key: 'content-links',
                  label: 'In-content links',
                  value: linking.content_link_count,
                  sub: `${linking.internal_link_count} including menus`,
                },
                {
                  key: 'incoming',
                  label: 'Have incoming links',
                  value: linkedShare === null ? null : formatPercentage(linkedShare),
                  sub: `${linking.pages_with_incoming_count} pages`,
                },
                orphanSegment({
                  pages: linking.orphan_pages,
                  total: linking.orphan_page_count,
                  onOpen: () => setOrphansOpen(true),
                }),
              ]}
            />
            <OrphanPageDrawer
              pages={linking.orphan_pages}
              total={linking.orphan_page_count}
              crawlId={data.crawl_id}
              open={orphansOpen}
              onOpenChange={setOrphansOpen}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <Inline as="span">
                <Icon icon={ListTree} className="text-muted" />
                Structure depth
              </Inline>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Stack>
              {data.structure_depth.buckets.map((bucket) => (
                <MeterRow
                  key={bucket.key}
                  name={DEPTH_LABELS[bucket.key]}
                  figure={`${bucket.page_count} (${formatPercentage(bucket.percentage)})`}
                  value={bucket.percentage === null ? null : Math.round(bucket.percentage * 100)}
                  label={`${DEPTH_LABELS[bucket.key]} share of pages`}
                  tone={{ series: 1 }}
                />
              ))}
              {data.structure_depth.unmeasured_page_count > 0 ? (
                <p className="type-caption">
                  {data.structure_depth.unmeasured_page_count} pages have no measured depth.
                </p>
              ) : null}
            </Stack>
          </CardContent>
        </Card>
      </div>
      <TextLink className="justify-self-start" href="/site?tab=internal-links">
        Review internal link suggestions
      </TextLink>
    </>
  );
}
