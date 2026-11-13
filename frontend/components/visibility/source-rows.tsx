import type { ComponentProps, ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Inline } from '@/components/ui/layout';
import { Pressable } from '@/components/ui/pressable';
import { TextLink } from '@/components/ui/text-link';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { MissingValue } from '@/components/ui/unavailable-value';
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
import { useEngineCatalog } from '@/lib/providers/engines';
import { standingLabel } from '@/lib/visibility/source-pages';
import { pageFormatBasis } from '@/lib/visibility/vocabulary';
import type { useVisibilityFilters } from '@/lib/visibility/use-visibility-dashboard';

export type SourceFilters = ReturnType<typeof useVisibilityFilters>;

/**
 * What the panel around a source table supplies: its toolbar, pager, the
 * background-refetch bar, the state that replaces the rows, and the page size
 * the body reserves. Loading, error and empty render inside the body under
 * the same header, so a filter change never moves the columns or the pager.
 */
export type SourceTableFrame = Pick<
  ComponentProps<typeof DataTable>,
  'toolbar' | 'pager' | 'busy' | 'state' | 'pageSize'
>;

/** The name cell: the whole cell opens the source's own level. */
function OpenSource({ onOpen, children }: Readonly<{ onOpen: () => void; children: ReactNode }>) {
  return (
    <Pressable
      onClick={onOpen}
      className="hover:text-accent-ink flex max-w-full min-w-0 items-center transition-colors"
    >
      {children}
    </Pressable>
  );
}

/** A source's type, with the basis for the claim behind a tooltip and in hidden text. */
function TypeChip({
  token,
  dimension,
  method,
}: Readonly<{ token: string | null; dimension: 'domain' | 'url'; method?: string | null }>) {
  const label = typeLabel(token, dimension);
  // A type nobody has established is "not measured", not a blank: the page has
  // simply not been read and its address did not settle the question. The
  // column header carries that explanation for the whole column.
  if (!label) return <MissingValue />;
  const chip = <Badge>{label}</Badge>;
  const basis = pageFormatBasis(method);
  if (!basis) return chip;
  // The tooltip serves a pointer; the hidden text gives keyboard and screen
  // reader users the same basis, since the chip itself cannot take focus.
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
    // Every figure takes the `figure` role and the source is the one flexible
    // column; the hint sits on the header button, so a figure's width holds
    // its label. Below the `xl` width the table scrolls behind the pinned
    // source rather than squeezing it: at `lg` the source kept too little
    // room for a domain on one line.
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
      // A share here, a count in the URL table: the unit is on the header.
      sublabel: '% of answers',
      width: 'figure',
      numeric: true,
      sort: sortProps(sort, onSort, 'response_rate'),
      hint: 'Answers that cited at least one page from this domain, as a share of all answers in the selection.',
    },
    {
      key: 'retrieved',
      label: 'Retrieved',
      sublabel: '% of answers',
      width: 'figure',
      numeric: true,
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
      numeric: true,
      desktopOnly: true,
      sort: sortProps(sort, onSort, 'retrieval_rate'),
      hint: 'Unique pages cited from this domain per answer in the selection.',
    },
    {
      key: 'citations',
      label: 'Citations',
      width: 'figure',
      numeric: true,
      sort: sortProps(sort, onSort, 'annotations'),
      hint: 'Every inline citation belonging to this domain.',
    },
    {
      key: 'share',
      label: 'Citation share',
      width: 'figure',
      numeric: true,
      desktopOnly: true,
      sort: sortProps(sort, onSort, 'citation_share'),
      hint: "This domain's citations as a share of every citation in the current filtered view.",
    },
    {
      key: 'rate',
      label: 'Citation rate',
      width: 'figure',
      numeric: true,
      desktopOnly: true,
      sort: sortProps(sort, onSort, 'citation_rate'),
      hint: 'Citations per answer that cited this domain — not per answer in the selection.',
    },
  ];
}

/**
 * The cited domains.
 *
 * Cited in and Retrieved sit next to each other on purpose: the first is how
 * often the engines cited the publisher, the second how often they read it.
 * A publisher read far more than it is cited is reaching the engines and still
 * losing the citation. Retrieved counts only answers whose engine exposes what
 * it read, so its denominator is those answers, never the whole selection.
 */
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
      minWidth="xl"
      pinFirstColumn
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
          <NumericCell value={percent(row.citation_share, 1)} desktopOnly />
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

/**
 * Where the business stands on the page, and the Action to get listed on it
 * when one exists. Only a read page carries a verdict.
 */
function PageStandingCell({
  standing,
  actionId,
}: Readonly<{ standing: SourceItem['standing']; actionId: string | null }>) {
  const label = standingLabel(standing);
  const tone = standingTone(standing);
  return (
    <Inline as="span" gap="meta">
      {tone ? (
        <Badge variant="status" value={tone}>
          {label}
        </Badge>
      ) : (
        <ClampText lines={1} className={textRole('caption', 'text-ink-secondary')}>
          {label}
        </ClampText>
      )}
      {actionId ? <TextLink href={`/agent/actions/${actionId}`}>Action</TextLink> : null}
    </Inline>
  );
}

function urlColumns(
  sort: SortState,
  onSort: (column: string) => void,
  retrieval: SourcesData['retrieval'] | undefined,
  engineLabel: (key: string) => string,
): DataTableColumn[] {
  // The URL is the one flexible column; every other column holds a role's
  // width. Nine columns cannot fit beside a readable URL at the owner's 982px,
  // so the table keeps a minimum width and scrolls behind the pinned URL.
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
      width: 'status',
      desktopOnly: true,
      hint: 'Whether this page has been read, and where you stand on it. A gap lists competitors and not you.',
    },
    {
      key: 'cited',
      label: 'Cited in',
      sublabel: 'Answers',
      width: 'figure',
      numeric: true,
      sort: sortProps(sort, onSort, 'responses'),
      hint: 'Answers that cited this URL.',
    },
    {
      key: 'retrieved',
      label: 'Retrieved',
      sublabel: 'Answers',
      width: 'figure',
      numeric: true,
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
      numeric: true,
      sort: sortProps(sort, onSort, 'citation_rate'),
      hint: 'Citations of this URL per answer that cited it.',
    },
    {
      key: 'mentions',
      label: 'Mentions',
      width: 'figure',
      numeric: true,
      desktopOnly: true,
      sort: sortProps(sort, onSort, 'mentions'),
      hint: 'Distinct brands named in the answers that cited this URL. Co-occurrence in the answer, not presence on the page.',
    },
    {
      key: 'mentioned',
      label: 'Mentioned',
      width: 'status',
      desktopOnly: true,
      hint: 'The brands named in the answers that cited this URL. Co-occurrence in the answer, not presence on the page.',
    },
    {
      key: 'seen',
      label: 'Last seen',
      width: 'figure',
      numeric: true,
      desktopOnly: true,
      sort: sortProps(sort, onSort, 'last_cited_at'),
      hint: 'The most recent run in this selection whose answer used this URL as a source.',
    },
  ];
}

/**
 * The cited pages.
 *
 * "Mentioned" is co-occurrence, never presence on the page: the chips are the
 * brands named in the ANSWERS that cited this URL, because no persisted row
 * links a mention to the citation beside it. The header tooltip says so, and
 * the column is not called "On page" for the same reason.
 */
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
      minWidth="xl"
      pinFirstColumn
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
