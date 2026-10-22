'use client';

import { Badge } from '@/components/ui/badge';
import { Pressable } from '@/components/ui/pressable';
import { TextLink } from '@/components/ui/text-link';
import { BrandLogo } from '@/components/ui/brand-logo';
import {
  ClampText,
  SortableTableHead,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  StateRows,
  type SourceTableState,
} from '@/components/visibility/source-cells';
import { HintedHead } from '@/components/visibility/source-heads';
import { standingLabel } from '@/lib/visibility/source-pages';
import { pageFormatBasis } from '@/lib/visibility/vocabulary';
import type { useVisibilityFilters } from '@/lib/visibility/use-visibility-dashboard';

export type SourceFilters = ReturnType<typeof useVisibilityFilters>;
export type { SourceTableState } from '@/components/visibility/source-cells';

/**
 * Each table's columns, as the classes that govern them.
 *
 * One list per table, shared by the header, the rows and the loading state, so
 * a column that is hidden below `lg` is hidden in ALL THREE. A skeleton that
 * rendered seven cells under a five-column header put a placeholder in every
 * wrong place and shifted the columns the moment the real rows arrived --
 * which is the movement this state exists to prevent.
 */
const DOMAIN_COLUMNS = [
  'w-[26%]',
  'w-[13%]',
  '',
  '',
  'hidden desktop:table-cell',
  '',
  'hidden desktop:table-cell',
  'hidden desktop:table-cell',
] as const;

const URL_COLUMNS = [
  'w-[26%]',
  'w-[11%]',
  'hidden desktop:table-cell w-[13%]',
  '',
  '',
  '',
  'hidden desktop:table-cell',
  'hidden desktop:table-cell',
  'hidden desktop:table-cell',
] as const;

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
  const chip = <Badge variant="neutral">{label}</Badge>;
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
  state = { kind: 'rows' },
}: Readonly<{
  rows: readonly SourceItem[];
  sort: SortState;
  onSort: (column: string) => void;
  onOpenDomain?: (domain: string) => void;
  retrieval?: SourcesData['retrieval'];
  /** Loading or empty fills the body; the header and footer stay put. */
  state?: SourceTableState;
}>) {
  const observed = retrieval?.responses ?? 0;
  return (
    // `table-fixed` with explicit column widths: without it every column sizes
    // to its own longest cell, so filtering to a shorter set of domains
    // re-lays out the whole table under the reader's pointer.
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <SortableTableHead
            label="Source"
            {...sortProps(sort, onSort, 'key')}
            className={DOMAIN_COLUMNS[0]}
          />
          <HintedHead
            label="Domain type"
            hint="How this publisher is classified. A domain nobody has classified yet has no type."
            className={DOMAIN_COLUMNS[1]}
          />
          <SortableTableHead
            label="Cited in"
            {...sortProps(sort, onSort, 'response_rate')}
            numeric
            hint="Answers that cited at least one page from this domain, as a share of all answers in the selection."
          />
          <SortableTableHead
            label="Retrieved"
            {...sortProps(sort, onSort, 'retrieved')}
            numeric
            hint={retrievedHint(
              'Answers that read at least one page from this domain, cited or not, as a share of the answers whose engine exposes what it read.',
              retrieval,
            )}
          />
          <SortableTableHead
            label="Pages cited"
            {...sortProps(sort, onSort, 'retrieval_rate')}
            numeric
            className={DOMAIN_COLUMNS[4]}
            hint="Unique pages cited from this domain per answer in the selection."
          />
          <SortableTableHead
            label="Citations"
            {...sortProps(sort, onSort, 'annotations')}
            numeric
            hint="Every inline citation belonging to this domain."
          />
          <SortableTableHead
            label="Citation share"
            {...sortProps(sort, onSort, 'citation_share')}
            numeric
            className={DOMAIN_COLUMNS[6]}
            hint="This domain's citations as a share of every citation in the current filtered view."
          />
          <SortableTableHead
            label="Citation rate"
            {...sortProps(sort, onSort, 'citation_rate')}
            numeric
            className={DOMAIN_COLUMNS[7]}
            hint="Citations per answer that cited this domain — not per answer in the selection."
          />
        </TableRow>
      </TableHeader>
      <TableBody>
        {state.kind !== 'rows' ? <StateRows state={state} columns={DOMAIN_COLUMNS} /> : null}
        {state.kind !== 'rows'
          ? null
          : rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>
                  <Pressable
                    onClick={() => onOpenDomain?.(row.key)}
                    className="hover:text-accent-text flex max-w-full min-w-0 items-center transition-colors"
                  >
                    <SourceName name={row.key || 'Domain unavailable'} host={row.key} />
                  </Pressable>
                </TableCell>
                <TableCell>
                  <TypeChip token={itemType(row)} dimension="domain" />
                </TableCell>
                <NumericCell value={percent(row.response_rate)} />
                <RetrievedCell
                  value={row.retrieved === null ? null : percent(row.retrieved / observed)}
                />
                <NumericCell value={ratio(row.retrieval_rate)} className={DOMAIN_COLUMNS[4]} />
                <NumericCell value={count(row.annotations)} />
                <NumericCell value={percent(row.citation_share, 1)} className={DOMAIN_COLUMNS[6]} />
                <NumericCell value={ratio(row.citation_rate)} className={DOMAIN_COLUMNS[7]} />
              </TableRow>
            ))}
      </TableBody>
    </Table>
  );
}

/**
 * The brands named alongside this source, as the marks a reader recognises.
 *
 * Real logos only — `BrandLogo` falls back to initials rather than inventing a
 * mark. The overflow count is the rest of the distinct brands, so the cell
 * never grows past three chips no matter how crowded the answer was.
 */
function MentionedChips({
  brands,
  total,
}: Readonly<{ brands: SourceItem['brands']; total: number }>) {
  if (!brands.length) return <MissingValue />;
  const overflow = total - brands.length;
  return (
    <span className="flex items-center gap-1">
      {brands.map((brand) => (
        <Tooltip
          key={`${brand.kind}:${brand.name}`}
          content={`${brand.name} — named in ${brand.responses} of the answers citing this URL`}
        >
          <span className="inline-flex">
            <BrandLogo
              name={brand.name}
              logoUrl={brand.logo_url}
              websiteUrl={brand.website}
              placement="mark"
            />
          </span>
        </Tooltip>
      ))}
      {overflow > 0 ? (
        <span className={textRole('caption', 'text-secondary tabular-nums')}>+{overflow}</span>
      ) : null}
    </span>
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
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {tone ? (
        <Badge variant="status" value={tone}>
          {label}
        </Badge>
      ) : (
        <ClampText lines={1} className={textRole('caption', 'text-secondary')}>
          {label}
        </ClampText>
      )}
      {actionId ? <TextLink href={`/agent/actions/${actionId}`}>Action</TextLink> : null}
    </span>
  );
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
  state = { kind: 'rows' },
}: Readonly<{
  rows: readonly SourceItem[];
  sort: SortState;
  onSort: (column: string) => void;
  onOpenUrl: (url: string) => void;
  retrieval?: SourcesData['retrieval'];
  /** Loading or empty fills the body; the header and footer stay put. */
  state?: SourceTableState;
}>) {
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <SortableTableHead
            label="URL"
            {...sortProps(sort, onSort, 'key')}
            className={URL_COLUMNS[0]}
          />
          <HintedHead
            label="URL type"
            hint="What kind of page this is: from the page itself once it has been read, otherwise from its address. A page whose kind is not evident shows as Other."
            className={URL_COLUMNS[1]}
          />
          <HintedHead
            label="On the page"
            hint="Whether this page has been read, and where you stand on it. A gap lists competitors and not you."
            className={URL_COLUMNS[2]}
          />
          <SortableTableHead
            label="Cited in"
            {...sortProps(sort, onSort, 'responses')}
            numeric
            hint="Answers that cited this URL."
          />
          <SortableTableHead
            label="Retrieved"
            {...sortProps(sort, onSort, 'retrieved')}
            numeric
            hint={retrievedHint(
              'Answers that read this URL, cited or not, among those whose engine exposes what it read.',
              retrieval,
            )}
          />
          <SortableTableHead
            label="Citation rate"
            {...sortProps(sort, onSort, 'citation_rate')}
            numeric
            hint="Citations of this URL per answer that cited it."
          />
          <SortableTableHead
            label="Mentions"
            {...sortProps(sort, onSort, 'mentions')}
            numeric
            className={URL_COLUMNS[6]}
            hint="Distinct brands named in the answers that cited this URL. Co-occurrence in the answer, not presence on the page."
          />
          <HintedHead
            label="Mentioned"
            hint="The brands named in the answers that cited this URL. Co-occurrence in the answer, not presence on the page."
            className={URL_COLUMNS[7]}
          />
          <SortableTableHead
            label="Last seen"
            {...sortProps(sort, onSort, 'last_cited_at')}
            numeric
            className={URL_COLUMNS[8]}
            hint="The most recent run in this selection whose answer used this URL as a source."
          />
        </TableRow>
      </TableHeader>
      <TableBody>
        {state.kind !== 'rows' ? <StateRows state={state} columns={URL_COLUMNS} /> : null}
        {state.kind !== 'rows'
          ? null
          : rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>
                  <Pressable
                    onClick={() => onOpenUrl(row.key)}
                    className="hover:text-accent-text flex max-w-full min-w-0 items-center transition-colors"
                  >
                    <SourceName
                      name={row.title?.trim() || pathOf(row.key)}
                      host={hostOf(row.key)}
                      secondary={row.title?.trim() ? pathOf(row.key) : null}
                    />
                  </Pressable>
                </TableCell>
                <TableCell>
                  <TypeChip
                    token={row.page_format}
                    dimension="url"
                    method={row.page_format_method}
                  />
                </TableCell>
                <TableCell className={URL_COLUMNS[2]}>
                  <PageStandingCell standing={row.standing} actionId={row.action_id} />
                </TableCell>
                <NumericCell value={count(row.responses)} />
                <RetrievedCell value={row.retrieved === null ? null : count(row.retrieved)} />
                <NumericCell value={ratio(row.citation_rate)} />
                <NumericCell value={count(row.mentions)} className={URL_COLUMNS[6]} />
                <TableCell className={URL_COLUMNS[7]}>
                  <MentionedChips brands={row.brands} total={row.mentions} />
                </TableCell>
                <NumericCell value={sinceLabel(row.last_cited_at)} className={URL_COLUMNS[8]} />
              </TableRow>
            ))}
      </TableBody>
    </Table>
  );
}
