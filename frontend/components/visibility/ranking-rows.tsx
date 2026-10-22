'use client';

import { Users } from 'lucide-react';

import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Inline } from '@/components/ui/layout';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { BrandLogo } from '@/components/ui/brand-logo';
import { Pressable } from '@/components/ui/pressable';
import { MissingValue } from '@/components/ui/unavailable-value';
import type { RankingRow } from '@/lib/api/types';
import {
  formatPosition,
  formatPositionExact,
  formatRate,
  measured,
} from '@/lib/visibility/dashboard';
import { Delta } from '@/components/ui/delta';
import { textRole } from '@/components/ui/typography';
import { tagClasses } from '@/components/ui/tag-variants';

/**
 * Where you stand against the brands you track.
 *
 * Two things used to make this table unreadable. Every row without a
 * comparable prior run printed the sentence "No comparable change" inside a
 * numeric cell, so a column of numbers became a column of wrapped prose; a
 * missing change is now an em dash, and the one sentence explaining why sits
 * above the table instead of in every row.
 *
 * The table compares brands on the measures every brand has: how often it is
 * named, where it lands among the brands an answer names, its share of voice,
 * and how often it is cited. "Answers without you" was none of those — it was
 * an overlap between one competitor and the tracked brand, undefined for the
 * tracked brand itself (which printed "Not applicable" in its own row) and so
 * asymmetric with every other column. The measure still exists on
 * `RankingRow.gap_count` and in the backend's `gap_counts` projection, where
 * opportunity analysis can use it; it is simply not a column of this table.
 *
 * The table is never paged: it holds at most six brands (owner, 2026-10-21).
 */

/** Stable identity for one row, matching the React key used below. */
function rowKey(row: RankingRow): string {
  return `${row.is_brand}-${row.name}`;
}

/**
 * Competitive rank, 1…N, over the ordering the table actually renders.
 *
 * `#1` is a claim about a brand's place among the brands beside it, so it has
 * to be derived from the comparison the table makes. It previously rendered
 * `avg_position` — the mean ordinal at which an answer first mentions a brand,
 * averaged over the answers naming THAT brand. Two brands each mentioned first
 * in their own answers both average 1.0 and both printed `#1`, while the rows
 * around them were ordered by visibility. The column and the row order were
 * answering different questions, and only one of them was the question `#1`
 * implies.
 *
 * Ties share a rank (1, 2, 2, 4): equal visibility is equal standing, and
 * breaking the tie alphabetically would invent a difference the measurement
 * does not support. A brand with no measured visibility has no standing to
 * report and is left unranked rather than pushed to last place.
 */
function competitiveRanks(ordered: readonly RankingRow[]): Map<string, number | null> {
  const ranks = new Map<string, number | null>();
  let previousRate: number | null = null;
  let previousRank = 0;
  ordered.forEach((row, index) => {
    if (row.mention_rate == null) {
      ranks.set(rowKey(row), null);
      return;
    }
    if (previousRate !== null && row.mention_rate === previousRate) {
      ranks.set(rowKey(row), previousRank);
      return;
    }
    previousRank = index + 1;
    previousRate = row.mention_rate;
    ranks.set(rowKey(row), previousRank);
  });
  return ranks;
}

/**
 * Whole-row click, for the mouse only.
 *
 * The row keeps its implicit `row` role: putting `role="button"` on a `<tr>`
 * REPLACES that role, which drops the row out of the table for anyone reading
 * it through the table's own structure. The accessible control is the real
 * button in the Brand cell; this is a convenience on top of it, so it adds no
 * role, no tabindex and no key handling of its own.
 */
function selectionProps(
  row: RankingRow,
  selected: boolean,
  onSelect?: (name: string | null) => void,
) {
  if (!onSelect) return {};
  return {
    onClick: () => onSelect(selected ? null : row.name),
    className: 'cursor-pointer',
  };
}

/**
 * The brand name, as the control that plots it alone.
 *
 * A real `<button>` rather than a handler on the row: it is focusable, it
 * announces its pressed state, and Enter/Space work without re-implementing
 * them. Clicks stop here so the row's own convenience handler does not toggle
 * the same selection a second time and cancel it.
 */
function BrandName({
  row,
  selected,
  onSelect,
}: Readonly<{
  row: RankingRow;
  selected: boolean;
  onSelect?: (name: string | null) => void;
}>) {
  const name = (
    <ClampText lines={1} className={textRole('emphasis')}>
      {row.name}
    </ClampText>
  );
  if (!onSelect) return name;
  return (
    <Pressable
      aria-pressed={selected}
      aria-label={selected ? `Stop plotting ${row.name} on its own` : `Plot ${row.name} on its own`}
      className="hover:text-accent-text w-auto min-w-0"
      onClick={(event) => {
        event.stopPropagation();
        onSelect(selected ? null : row.name);
      }}
    >
      {name}
    </Pressable>
  );
}

/**
 * A brand's place in the ranking, with the mean it rounds from behind it.
 *
 * `#1.2` reads as a broken ordinal rather than an average, and a reader cannot
 * be anywhere other than a whole place in a list -- so the cell shows the
 * whole number and the title keeps the fraction that separates two brands
 * rounding to the same place.
 */
function PositionValue({
  row,
  rank,
  rankedCount,
}: Readonly<{ row: RankingRow; rank: number | null; rankedCount: number }>) {
  if (rank == null) return <MissingValue />;
  const mean =
    row.avg_position == null
      ? ''
      : `, and is named ${formatPositionExact(row.avg_position)} on average within the answers that name it`;
  return (
    <span
      title={`${row.name} ranks ${formatPosition(rank)} of ${rankedCount} tracked brands by visibility${mean}`}
    >
      {formatPosition(rank)}
    </span>
  );
}

export function RankingRowsTable({
  rows,
  onSelect,
  selectedName = null,
}: Readonly<{
  rows: readonly RankingRow[];
  /**
   * Plot this brand alone in the chart beside the table. Selecting the brand
   * already selected clears it, so the same row both focuses and restores.
   */
  onSelect?: (name: string | null) => void;
  selectedName?: string | null;
}>) {
  const ordered = [...rows].sort(
    (a, b) => (b.mention_rate ?? -1) - (a.mention_rate ?? -1) || a.name.localeCompare(b.name),
  );
  // With no prior run there is no change for ANY brand, and a column of
  // "No comparable change" told the reader nothing seven times over. The reason
  // is stated once above the table instead.
  const anyChange = ordered.some(
    (row) => (row.matched_visibility_delta ?? row.visibility_delta) != null,
  );
  const ranks = competitiveRanks(ordered);
  const rankedCount = [...ranks.values()].filter((rank) => rank != null).length;
  // Nothing measured means nothing to rank, so the column is omitted rather
  // than filled with a placeholder in every row.
  const anyPosition = rankedCount > 0;
  return (
    <DataTable
      title="Brand and competitors"
      columns={rankingColumns({ anyPosition, anyChange })}
      state={
        ordered.length
          ? undefined
          : {
              kind: 'empty',
              headingLevel: 3,
              icon: Users,
              heading: 'No measured responses in this selection.',
            }
      }
      footer="How often each brand is named, across the same answers. Select a row to plot it on its own."
    >
      {ordered.map((row) => {
        // A matched-subset delta is the same measurement taken over the cells
        // both runs share. Which one it is belongs to the note above the
        // table, not to a disclosure inside every cell.
        const change = row.matched_visibility_delta ?? row.visibility_delta;
        const selected = selectedName === row.name;
        return (
          <TableRow
            key={`${row.is_brand}-${row.name}`}
            highlight={row.is_brand || selected}
            {...selectionProps(row, selected, onSelect)}
          >
            <TableCell>
              <Inline as="span">
                <BrandLogo name={row.name} logoUrl={row.logo_url} websiteUrl={row.website_url} />
                <BrandName row={row} selected={selected} onSelect={onSelect} />
                {row.is_brand ? (
                  <span className={textRole('label', tagClasses('well', 'shrink-0'))}>You</span>
                ) : null}
              </Inline>
              <ClampText lines={1} className={textRole('caption', 'text-secondary desktop:hidden')}>
                {formatRate(row.share_of_voice)} share of voice · {formatRate(row.citation_rate)}{' '}
                citations
              </ClampText>
            </TableCell>
            {/* The rate is the column. Printing its fraction under every
                  row turned a scannable column of percentages into two
                  stacked numbers per cell. */}
            <TableCell numeric>
              {measured(formatRate(row.mention_rate)) ?? <MissingValue />}
            </TableCell>
            {anyPosition ? (
              <TableCell numeric>
                <PositionValue
                  row={row}
                  rank={ranks.get(rowKey(row)) ?? null}
                  rankedCount={rankedCount}
                />
              </TableCell>
            ) : null}
            {anyChange ? (
              <TableCell numeric>
                <Delta value={change} unit=" pp" />
              </TableCell>
            ) : null}
            <TableCell numeric desktopOnly>
              {measured(formatRate(row.share_of_voice)) ?? <MissingValue />}
            </TableCell>
            <TableCell numeric desktopOnly>
              {measured(formatRate(row.citation_rate)) ?? <MissingValue />}
            </TableCell>
          </TableRow>
        );
      })}
    </DataTable>
  );
}

function rankingColumns({
  anyPosition,
  anyChange,
}: Readonly<{ anyPosition: boolean; anyChange: boolean }>): DataTableColumn[] {
  return [
    { key: 'brand', label: 'Brand' },
    { key: 'visibility', label: 'Visibility', width: 'figure', numeric: true },
    // "Rank", not "Position": the headline Average position is the mean order
    // an answer names you in, a different measure that can read #1 while this
    // column reads #3.
    ...(anyPosition
      ? [{ key: 'rank', label: 'Rank', width: 'figure', numeric: true } as const]
      : []),
    ...(anyChange
      ? [{ key: 'change', label: 'Change', width: 'figure', numeric: true } as const]
      : []),
    { key: 'sov', label: 'Share of voice', width: 'figure', numeric: true, desktopOnly: true },
    { key: 'citations', label: 'Citations', width: 'figure', numeric: true, desktopOnly: true },
  ];
}
