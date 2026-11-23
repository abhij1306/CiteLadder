import type { ComponentProps, ReactNode } from 'react';
import { Icon } from '@/components/ui/icon';

import { StatusMark } from '@/components/ui/status-mark';
import { Tag } from '@/components/ui/tag';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Inline } from '@/components/ui/layout';
import { Pressable } from '@/components/ui/pressable';
import { TextLink } from '@/components/ui/text-link';
import { ClampText } from '@/components/ui/clamp-text';
import { TableCell, TableRow } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { Absence } from '@/components/ui/absence';
import { textRole } from '@/components/ui/typography';
import {
  count,
  hostOf,
  itemType,
  pathOf,
  percent,
  ratio,
  sinceLabel,
  typeLabel,
  type SortState,
  type SourceItem,
  type SourcesData,
} from '@/lib/visibility/sources';
import {
  NumericCell,
  RetrievedCell,
  retrievedHint,
  SourceName,
  sortProps,
} from '@/components/visibility/source-cells';
import { NamedBrandMarks } from '@/components/visibility/named-brand-marks';
import { ChevronRight } from '@/lib/icons';
import { useEngineCatalog } from '@/lib/providers/engines';
import { standingLabel } from '@citeladder/contracts/page-labels';
import { pageFormatBasis } from '@/lib/visibility/vocabulary';
import type { useVisibilityFilters } from '@/lib/visibility/use-visibility-dashboard';

export type SourceFilters = ReturnType<typeof useVisibilityFilters>;

export type SourceTableFrame = Pick<
  ComponentProps<typeof DataTable>,
  'toolbar' | 'pager' | 'busy' | 'state' | 'pageSize'
>;

export function OpenSource({
  onOpen,
  children,
}: Readonly<{ onOpen: () => void; children: ReactNode }>) {
  return (
    <Pressable onClick={onOpen} className="block min-w-0">
      <Inline as="span" className="justify-between">
        <span className="min-w-0">{children}</span>
        <Icon icon={ChevronRight} className="text-ink-2 shrink-0" />
      </Inline>
    </Pressable>
  );
}

function TypeChip({
  token,
  dimension,
  method,
}: Readonly<{ token: string | null; dimension: 'domain' | 'url'; method?: string | null }>) {
  const label = typeLabel(token, dimension);
  if (!label) return <Absence />;
  const chip = <Tag>{label}</Tag>;
  const basis = pageFormatBasis(method);
  if (!basis) return chip;
  return (
    <>
      <Tooltip content={basis}>{chip}</Tooltip>
      <span className="sr-only">{`, ${basis}`}</span>
    </>
  );
}

function domainColumns(
  sort: SortState,
  onSort: (column: string) => void,
  retrieval: SourcesData['retrieval'] | undefined,
  engineLabel: (key: string) => string,
): DataTableColumn[] {
  return [
    { key: 'source', label: 'Source', sort: sortProps(sort, onSort, 'key') },
    {
      key: 'type',
      label: 'Domain type',
      width: 'status',
      hint: 'How this publisher is classified. A domain nobody has classified yet has no type.',
    },
    {
      key: 'cited',
      label: 'Cited in',
      sublabel: '% of answers',
      width: 'figure',
      kind: 'number',
      sort: sortProps(sort, onSort, 'response_rate'),
      hint: 'Answers that cited at least one page from this domain, as a share of all answers in the selection.',
    },
    {
      key: 'retrieved',
      label: 'Retrieved',
      sublabel: '% of answers',
      width: 'figure',
      kind: 'number',
      sort: sortProps(sort, onSort, 'retrieved'),
      hint: retrievedHint(
        'Answers that read at least one page from this domain, cited or not, as a share of the answers whose engine exposes what it read.',
        retrieval,
        engineLabel,
      ),
    },
    {
      key: 'pages',
      label: 'Pages cited',
      width: 'figure',
      kind: 'number',
      desktopOnly: true,
      priority: 'low',
      sort: sortProps(sort, onSort, 'retrieval_rate'),
      hint: 'Unique pages cited from this domain per answer in the selection.',
    },
    {
      key: 'citations',
      label: 'Citations',
      width: 'figure',
      kind: 'number',
      sort: sortProps(sort, onSort, 'annotations'),
      hint: 'Every inline citation belonging to this domain.',
    },
    {
      key: 'share',
      label: 'Citation share',
      width: 'figure',
      kind: 'number',
      desktopOnly: true,
      priority: 'low',
      sort: sortProps(sort, onSort, 'citation_share'),
      hint: "This domain's citations as a share of every citation in the current filtered view.",
    },
    {
      key: 'rate',
      label: 'Citation rate',
      width: 'figure',
      kind: 'number',
      desktopOnly: true,
      priority: 'low',
      sort: sortProps(sort, onSort, 'citation_rate'),
      hint: 'Citations per answer that cited this domain, not per answer in the selection.',
    },
  ];
}

export function DomainTable({
  rows,
  sort,
  onSort,
  onOpenDomain,
  retrieval,
  frame = {},
}: Readonly<{
  rows: readonly SourceItem[];
  sort: SortState;
  onSort: (column: string) => void;
  onOpenDomain?: (domain: string) => void;
  retrieval?: SourcesData['retrieval'];
  frame?: SourceTableFrame;
}>) {
  const observed = retrieval?.responses ?? 0;
  const engines = useEngineCatalog();
  return (
    <DataTable
      label="Cited domains"
      columns={domainColumns(sort, onSort, retrieval, engines.label)}
      rowCount={rows.length}
      {...frame}
    >
      {rows.map((row) => (
        <TableRow key={row.key}>
          <TableCell>
            <OpenSource onOpen={() => onOpenDomain?.(row.key)}>
              <SourceName name={row.key || 'Domain unavailable'} host={row.key} />
            </OpenSource>
          </TableCell>
          <TableCell>
            <TypeChip token={itemType(row)} dimension="domain" />
          </TableCell>
          <NumericCell value={percent(row.response_rate)} />
          <RetrievedCell
            value={row.retrieved === null ? null : percent(row.retrieved / observed)}
          />
          <NumericCell value={ratio(row.retrieval_rate)} desktopOnly />
          <NumericCell value={count(row.annotations)} />
          <NumericCell value={percent(row.citation_share)} desktopOnly />
          <NumericCell value={ratio(row.citation_rate)} desktopOnly />
        </TableRow>
      ))}
    </DataTable>
  );
}

function standingTone(standing: SourceItem['standing']) {
  if (standing === 'gap') return 'warning';
  if (standing === 'listed') return 'success';
  return null;
}

function PageStandingCell({
  standing,
  actionId,
}: Readonly<{ standing: SourceItem['standing']; actionId: string | null }>) {
  const label = standingLabel(standing);
  const tone = standingTone(standing);
  return (
    <Inline as="span" gap="item" className="whitespace-nowrap">
      {tone ? (
        <StatusMark variant="status" value={tone}>
          {label}
        </StatusMark>
      ) : (
        <ClampText lines={1} className={textRole('caption', 'text-ink-2')}>
          {label}
        </ClampText>
      )}
      {actionId ? <TextLink href={`/actions/${actionId}`}>Action</TextLink> : null}
    </Inline>
  );
}

function urlColumns(
  sort: SortState,
  onSort: (column: string) => void,
  retrieval: SourcesData['retrieval'] | undefined,
  engineLabel: (key: string) => string,
): DataTableColumn[] {
  return [
    { key: 'url', label: 'URL', sort: sortProps(sort, onSort, 'key') },
    {
      key: 'type',
      label: 'URL type',
      width: 'status',
      hint: 'What kind of page this is: from the page itself once it has been read, otherwise from its address. A page whose kind is not evident shows as Other.',
    },
    {
      key: 'standing',
      label: 'On the page',
      width: 'category',
      desktopOnly: true,
      hint: 'Whether this page has been read, and where you stand on it. A gap lists competitors and not you.',
    },
    {
      key: 'cited',
      label: 'Cited in',
      sublabel: 'Answers',
      width: 'figure',
      kind: 'number',
      sort: sortProps(sort, onSort, 'responses'),
      hint: 'Answers that cited this URL.',
    },
    {
      key: 'retrieved',
      label: 'Retrieved',
      sublabel: 'Answers',
      width: 'figure',
      kind: 'number',
      sort: sortProps(sort, onSort, 'retrieved'),
      hint: retrievedHint(
        'Answers that read this URL, cited or not, among those whose engine exposes what it read.',
        retrieval,
        engineLabel,
      ),
    },
    {
      key: 'rate',
      label: 'Citation rate',
      width: 'figure',
      kind: 'number',
      priority: 'low',
      sort: sortProps(sort, onSort, 'citation_rate'),
      hint: 'Citations of this URL per answer that cited it.',
    },
    {
      key: 'mentions',
      label: 'Mentions',
      width: 'figure',
      kind: 'number',
      desktopOnly: true,
      priority: 'low',
      sort: sortProps(sort, onSort, 'mentions'),
      hint: 'Distinct brands named in the answers that cited this URL. Co-occurrence in the answer, not presence on the page.',
    },
    {
      key: 'mentioned',
      label: 'Mentioned',
      width: 'marks',
      desktopOnly: true,
      priority: 'low',
      hint: 'The brands named in the answers that cited this URL. Co-occurrence in the answer, not presence on the page.',
    },
    {
      key: 'seen',
      label: 'Last seen',
      width: 'figure',
      kind: 'number',
      desktopOnly: true,
      priority: 'low',
      sort: sortProps(sort, onSort, 'last_cited_at'),
      hint: 'The most recent run in this selection whose answer used this URL as a source.',
    },
  ];
}

export function UrlTable({
  rows,
  sort,
  onSort,
  onOpenUrl,
  retrieval,
  frame = {},
}: Readonly<{
  rows: readonly SourceItem[];
  sort: SortState;
  onSort: (column: string) => void;
  onOpenUrl: (url: string) => void;
  retrieval?: SourcesData['retrieval'];
  frame?: SourceTableFrame;
}>) {
  const engines = useEngineCatalog();
  return (
    <DataTable
      label="Cited URLs"
      columns={urlColumns(sort, onSort, retrieval, engines.label)}
      rowCount={rows.length}
      {...frame}
    >
      {rows.map((row) => (
        <TableRow key={row.key}>
          <TableCell>
            <OpenSource onOpen={() => onOpenUrl(row.key)}>
              <SourceName
                name={row.title?.trim() || pathOf(row.key)}
                host={hostOf(row.key)}
                secondary={row.title?.trim() ? pathOf(row.key) : null}
              />
            </OpenSource>
          </TableCell>
          <TableCell>
            <TypeChip token={row.page_format} dimension="url" method={row.page_format_method} />
          </TableCell>
          <TableCell desktopOnly>
            <PageStandingCell standing={row.standing} actionId={row.action_id} />
          </TableCell>
          <NumericCell value={count(row.responses)} />
          <RetrievedCell value={row.retrieved === null ? null : count(row.retrieved)} />
          <NumericCell value={ratio(row.citation_rate)} />
          <NumericCell value={count(row.mentions)} desktopOnly />
          <TableCell desktopOnly>
            <NamedBrandMarks
              brands={row.brands}
              total={row.mentions}
              answers="the answers citing this URL"
            />
          </TableCell>
          <NumericCell value={sinceLabel(row.last_cited_at)} desktopOnly />
        </TableRow>
      ))}
    </DataTable>
  );
}
