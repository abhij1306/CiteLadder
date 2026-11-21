import { Fragment, useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { HierarchyCard } from '@/components/site-health/architecture-hierarchy';
import { OrphanPageDrawer, orphanSegment } from '@/components/site-health/architecture-orphans';
import { PageKindBadge } from '@/components/site-health/page-kind-badge';
import { AppGrid } from '@/components/ui/app-grid';
import { Button } from '@/components/ui/button';
import { ProjectLink } from '@/components/ui/project-link';
import { StatusMark } from '@/components/ui/status-mark';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { useShownSpan } from '@/components/ui/data-table-fit';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { MeterRow } from '@/components/ui/meter';
import { Pressable } from '@/components/ui/pressable';
import { TextLink } from '@/components/ui/text-link';
import { Absence, printed } from '@/components/ui/absence';
import { ClampText } from '@/components/ui/clamp-text';
import { TableCell, TableRow } from '@/components/ui/table';
import { ChevronDown, ChevronRight, ListTree } from '@/lib/icons';
import { siteHealthQueries } from '@/lib/api/site-health-queries';
import type {
  ArchitectureNode,
  ArchitecturePageKind,
  CoverageState,
  SiteArchitecture,
} from '@citeladder/contracts';
import { formatCount, formatPercent, formattedText } from '@/lib/format';
import { readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';
import {
  Section,
  SectionContent,
  SectionDescription,
  SectionHeader,
  SectionTitle,
} from '@/components/ui/section';
import { ChartFrame } from '@/components/ui/chart-frame';
import { FigureStrip } from '@/components/ui/figure-strip';

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
  sitemap_limit_reached: 'the sitemap listed more than the crawl could read',
  sitemap_documents_unread: 'a sitemap file could not be read',
  tracked_pages_below_site: 'the sitemap lists more pages than the crawl tracks',
  sitemap_exhausted: 'the crawl read the whole sitemap and every page it lists',
};

const DEPTH_LABELS = {
  depth_0: 'Depth 0',
  depth_1: 'Depth 1',
  depth_2: 'Depth 2',
  depth_3_plus: 'Depth 3+',
} as const;

export function ArchitecturePanel({
  workspaceId,
  projectId,
  crawlId,
}: Readonly<{ workspaceId: string; projectId: string; crawlId?: string }>) {
  const architecture = useQuery(
    siteHealthQueries.architecture({ workspaceId, projectId }, crawlId),
  );

  if (architecture.isLoading) {
    return (
      <StateBlock
        kind="loading"
        label="Loading the observed architecture"
        shape={{ kind: 'figures', count: 3 }}
      />
    );
  }
  if (architecture.isError)
    return (
      <StateBlock
        kind="error"
        {...readErrorProps(architecture)}
        fallback="Couldn't load the site architecture."
        title="Couldn't load the site architecture"
      />
    );
  if (!architecture.data || architecture.data.state === 'unavailable') {
    return (
      <StateBlock
        kind="empty"
        heading="Site architecture isn't available yet"
        description={architecture.data?.limitations[0]}
      />
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

  return (
    <Stack gap="workspace" className="min-w-0" data-testid="site-architecture">
      <ArchitectureEvidence data={data} />
      <PageKindTable
        pageKinds={pageKinds}
        grouped={grouped}
        crawlId={data.crawl_id}
        coverage={data.coverage_state}
        reasons={data.coverage_reasons}
      />
      <HierarchyCard nodes={data.nodes} crawlId={data.crawl_id} />
    </Stack>
  );
}

function pageKindDescription(coverage: CoverageState, reasons: readonly string[]): string | null {
  const named = reasons.filter((reason) => reason in COVERAGE_REASON_LABELS);
  if (coverage === 'complete' || named.length === 0) return null;
  const why = named.map((reason) => COVERAGE_REASON_LABELS[reason]).join('; ');
  return `Limited: ${why}`;
}

function PageKindTable({
  pageKinds,
  grouped,
  crawlId,
  coverage,
  reasons,
}: Readonly<{
  pageKinds: ArchitecturePageKind[];
  grouped: Map<string, ArchitectureNode[]>;
  crawlId: string | null;
  coverage: CoverageState;
  reasons: readonly string[];
}>) {
  const [openKind, setOpenKind] = useState<string | null>(null);
  const pagesId = useId();
  const why = pageKindDescription(coverage, reasons);
  return (
    <Section>
      <SectionHeader
        actions={
          <StatusMark variant="status" value={coverage === 'complete' ? 'success' : 'warning'}>
            {COVERAGE_LABELS[coverage]}
          </StatusMark>
        }
      >
        <SectionTitle>Page kinds</SectionTitle>
        {why ? <SectionDescription>{why}</SectionDescription> : null}
      </SectionHeader>
      <DataTable
        label="Page kinds"
        columns={PAGE_KIND_COLUMNS}
        state={
          pageKinds.length === 0
            ? {
                kind: 'empty',
                icon: ListTree,
                headingLevel: 3,
                heading: 'No page kinds were measured',
              }
            : undefined
        }
      >
        {pageKinds.map((pageKind) => {
          const open = openKind === pageKind.page_kind;
          const pages = grouped.get(pageKind.page_kind) ?? [];
          const listId = `${pagesId}-${pageKind.page_kind}`;
          return (
            <Fragment key={pageKind.page_kind}>
              <TableRow>
                <TableCell>
                  <Pressable
                    type="button"
                    aria-expanded={open}
                    aria-controls={listId}
                    onClick={() => setOpenKind(open ? null : pageKind.page_kind)}
                    className="w-auto"
                  >
                    <Inline as="span">
                      <Icon icon={open ? ChevronDown : ChevronRight} className="text-ink-2" />
                      <PageKindBadge pageKind={pageKind.page_kind} />
                    </Inline>
                  </Pressable>
                </TableCell>
                <TableCell numeric>{pageKind.page_count}</TableCell>
                <TableCell numeric>
                  {pageKind.median_depth ?? <Absence state="not_measured" />}
                </TableCell>
                <TableCell numeric>
                  {pageKind.indexable_count} / {pageKind.page_count}
                </TableCell>
                <TableCell numeric>
                  {pageKind.orphan_count ?? <Absence state="not_measured" />}
                </TableCell>
              </TableRow>
              {open ? <PageKindPages id={listId} pages={pages} crawlId={crawlId} /> : null}
            </Fragment>
          );
        })}
      </DataTable>
    </Section>
  );
}

const PAGE_KIND_COLUMNS: readonly DataTableColumn[] = [
  { key: 'kind', label: 'Page kind', kind: 'identity' },
  { key: 'pages', label: 'Pages crawled', kind: 'number' },
  { key: 'depth', label: 'Median depth', kind: 'number' },
  { key: 'indexable', label: 'Indexable', kind: 'number' },
  { key: 'orphaned', label: 'Orphaned', kind: 'number', priority: 'low' },
];
const PAGE_KIND_KEYS = PAGE_KIND_COLUMNS.map((column) => column.key);

function PageKindPages({
  id,
  pages,
  crawlId,
}: Readonly<{ id: string; pages: ArchitectureNode[]; crawlId: string | null }>) {
  const span = useShownSpan(PAGE_KIND_KEYS);
  return (
    <TableRow id={id} className="bg-well hover:bg-well">
      <TableCell colSpan={span}>
        {pages.length === 0 ? (
          <StateBlock kind="empty" inline message="No pages of this kind to list." />
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
                  <ClampText lines={1} className="type-body text-ink">
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

function depthSummary(data: SiteArchitecture): string {
  const parts = data.structure_depth.buckets.map(
    (bucket) =>
      `${DEPTH_LABELS[bucket.key]}: ${bucket.page_count} pages (${formattedText(formatPercent(bucket.percentage))})`,
  );
  return `Share of pages by click depth from the homepage. ${parts.join('; ')}.`;
}

function ArchitectureEvidence({ data }: Readonly<{ data: SiteArchitecture }>) {
  const linking = data.internal_linking;
  const [orphansOpen, setOrphansOpen] = useState(false);
  const linkedShare = linking.pages_with_incoming_percentage;
  return (
    <AppGrid layout="main-aside">
      <Section>
        <SectionHeader
          actions={
            <Button asChild variant="secondary">
              <ProjectLink href="/site?tab=internal-links">
                Review internal link suggestions
              </ProjectLink>
            </Button>
          }
        >
          <SectionTitle>Internal linking</SectionTitle>
        </SectionHeader>
        <SectionContent>
          <FigureStrip
            segments={[
              {
                key: 'content-links',
                label: 'In-content links',
                value: linking.content_link_count,
                sub: `${formatCount(linking.internal_link_count)} including menus`,
              },
              {
                key: 'incoming',
                label: 'Have incoming links',
                value: linkedShare === null ? null : formatPercent(linkedShare),
                sub: `${formatCount(linking.pages_with_incoming_count)} pages crawled`,
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
        </SectionContent>
      </Section>
      <Section>
        <SectionHeader>
          <SectionTitle>Structure depth</SectionTitle>
        </SectionHeader>
        <SectionContent>
          <Stack>
            <ChartFrame summary={depthSummary(data)}>
              <Stack>
                {data.structure_depth.buckets.map((bucket) => (
                  <MeterRow
                    key={bucket.key}
                    name={DEPTH_LABELS[bucket.key]}
                    figure={
                      <>
                        {formatCount(bucket.page_count)} (
                        {printed(formatPercent(bucket.percentage))})
                      </>
                    }
                    value={bucket.percentage === null ? null : Math.round(bucket.percentage * 100)}
                    label={`${DEPTH_LABELS[bucket.key]} share of pages`}
                    tone="neutral"
                  />
                ))}
              </Stack>
            </ChartFrame>
            {data.structure_depth.unmeasured_page_count > 0 ? (
              <p className="type-caption">
                {formatCount(data.structure_depth.unmeasured_page_count)} pages crawled have no
                measured depth.
              </p>
            ) : null}
          </Stack>
        </SectionContent>
      </Section>
    </AppGrid>
  );
}
