'use client';

import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Link2, ListTree } from 'lucide-react';

import { HierarchyCard } from '@/components/site-health/architecture-hierarchy';
import {
  ORPHAN_SCOPE_NOTE,
  OrphanMetric,
  OrphanPageDrawer,
} from '@/components/site-health/architecture-orphans';
import { PageKindBadge } from '@/components/site-health/page-kind-badge';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { Stack } from '@/components/ui/layout';
import { Meter } from '@/components/ui/meter';
import { Pressable } from '@/components/ui/pressable';
import { QueryState } from '@/components/ui/query-state';
import { StatGrid, StatItem } from '@/components/ui/stat-grid';
import { TextLink } from '@/components/ui/text-link';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import {
  ClampText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRecordMetricCell,
  TableRow,
} from '@/components/ui/table';
import { MetricGroup, MetricItem, splitPaneClasses } from '@/components/ui/workspace';
import { siteHealthQueries } from '@/lib/api/site-health';
import type {
  ArchitectureNode,
  ArchitecturePageKind,
  CoverageState,
  SiteArchitecture,
} from '@/lib/api/types';
import { PLACEHOLDER } from '@/lib/site-health/status';
import { textRole } from '@/components/ui/typography';

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
        <CardContent className="grid gap-3">
          <ArchitectureMetrics
            pageKinds={pageKinds.length}
            pages={data.page_count}
            medianDepth={median(depths)}
            duplicatePages={duplicatePages}
            orphanCount={data.internal_linking.orphan_page_count}
          />
          <CoverageReasons reasons={data.coverage_reasons} />
          {pageKinds.length === 0 ? (
            <InlineEmpty>No page kinds were measured.</InlineEmpty>
          ) : (
            <PageKindTable pageKinds={pageKinds} grouped={grouped} crawlId={data.crawl_id} />
          )}
        </CardContent>
      </Card>
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
    <MetricGroup>
      {items.map(([label, value, supporting]) => (
        <MetricItem
          key={label}
          label={label}
          value={value === PLACEHOLDER ? <UnavailableValue state="not_measured" /> : value}
          detail={supporting}
        />
      ))}
    </MetricGroup>
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
    <Table className="desktop:table block" wrapperClassName="overflow-hidden desktop:overflow-auto">
      <TableHeader className="desktop:table-header-group hidden">
        <TableRow>
          <TableHead>Page kind</TableHead>
          <TableHead numeric>Pages</TableHead>
          <TableHead numeric>Median depth</TableHead>
          <TableHead numeric>Indexable</TableHead>
          <TableHead numeric>Duplicate metadata</TableHead>
          <TableHead numeric>Orphaned</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody className="desktop:table-row-group block">
        {pageKinds.map((pageKind) => {
          const open = openKind === pageKind.page_kind;
          const pages = grouped.get(pageKind.page_kind) ?? [];
          const Chevron = open ? ChevronDown : ChevronRight;
          return (
            <Fragment key={pageKind.page_kind}>
              <TableRow className="desktop:table-row desktop:h-[var(--table-row-height)] desktop:py-0 grid h-auto grid-cols-1 py-2">
                <TableCell className="desktop:table-cell desktop:border-b desktop:px-[var(--table-cell-padding-x)] desktop:py-[var(--table-cell-padding-y)] block border-b-0 px-4 py-1">
                  <Pressable
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenKind(open ? null : pageKind.page_kind)}
                    className="desktop:min-h-9 inline-flex min-h-11 w-auto items-center gap-2 text-left"
                  >
                    <Chevron className="text-muted size-4 shrink-0" aria-hidden />
                    <PageKindBadge pageKind={pageKind.page_kind} />
                  </Pressable>
                </TableCell>
                <TableRecordMetricCell label="Pages">{pageKind.page_count}</TableRecordMetricCell>
                <TableRecordMetricCell label="Median depth">
                  {pageKind.median_depth ?? <UnavailableValue state="not_measured" />}
                </TableRecordMetricCell>
                <TableRecordMetricCell label="Indexable">
                  {pageKind.indexable_count} / {pageKind.page_count}
                </TableRecordMetricCell>
                <TableRecordMetricCell label="Duplicate metadata">
                  {pageKind.duplicate_metadata_count}
                </TableRecordMetricCell>
                <TableRecordMetricCell label="Orphaned">
                  {pageKind.orphan_count ?? <UnavailableValue state="not_measured" />}
                </TableRecordMetricCell>
              </TableRow>
              {open ? <PageKindPages pages={pages} crawlId={crawlId} /> : null}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

function PageKindPages({
  pages,
  crawlId,
}: Readonly<{ pages: ArchitectureNode[]; crawlId: string | null }>) {
  return (
    <TableRow className="bg-background-alt hover:bg-background-alt desktop:table-row desktop:h-[var(--table-row-height)] block h-auto">
      <TableCell colSpan={6} className="desktop:table-cell block py-3">
        {pages.length === 0 ? (
          <InlineEmpty>No projected URLs are available for this kind.</InlineEmpty>
        ) : (
          <ul className="content-scroll grid max-h-64 gap-2 overflow-y-auto overscroll-contain pr-2 pl-6">
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
          </ul>
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
            <CardTitle className="flex items-center gap-2">
              <Link2 className="text-muted size-4" aria-hidden />
              Internal linking
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <StatGrid columns={3} size="figure">
              <StatItem
                label="In-content links"
                value={linking.content_link_count}
                detail={`${linking.internal_link_count} including menus`}
              />
              <StatItem
                label="Have incoming links"
                value={linkedShare === null ? null : formatPercentage(linkedShare)}
                detail={`${linking.pages_with_incoming_count} pages`}
              />
              <OrphanMetric
                pages={linking.orphan_pages}
                total={linking.orphan_page_count}
                onOpen={() => setOrphansOpen(true)}
              />
            </StatGrid>
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
            <CardTitle className="flex items-center gap-2">
              <ListTree className="text-muted size-4" aria-hidden />
              Structure depth
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {data.structure_depth.buckets.map((bucket) => (
              <div key={bucket.key} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3">
                <span className="type-caption">{DEPTH_LABELS[bucket.key]}</span>
                <Meter
                  value={bucket.percentage === null ? null : Math.round(bucket.percentage * 100)}
                  label={`${DEPTH_LABELS[bucket.key]} share of pages`}
                  tone={{ series: 1 }}
                />
                <span className={textRole('label', 'min-w-16 text-right tabular-nums')}>
                  {bucket.page_count} ({formatPercentage(bucket.percentage)})
                </span>
              </div>
            ))}
            {data.structure_depth.unmeasured_page_count > 0 ? (
              <p className="type-caption">
                {data.structure_depth.unmeasured_page_count} pages have no measured depth.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <TextLink className="justify-self-start" href="/site?tab=internal-links">
        Review internal link suggestions
      </TextLink>
    </>
  );
}
