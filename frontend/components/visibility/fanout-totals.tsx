'use client';

import { InlineEmpty } from '@/components/ui/inline-empty';
import { textRole } from '@/components/ui/typography';

/** What the fanout projection answers about the whole selection. */
export type FanoutSummary = Readonly<{
  distinctQueries: number | null;
  eventCount: number | null;
  matchedQueries: number | null;
}>;

/**
 * Whether the server's figures describe the population the table draws from.
 *
 * They do only when the summary has landed AND the table is not narrowed past
 * what the fanout endpoint takes — it accepts the run/engine/cohort scope, but
 * not the prompt, outcome, competitor, domain or URL filters the evidence
 * table also applies. When it is narrowed, the server is counting a larger
 * population than the reader can see.
 */
export function isSelectionWide(summary: FanoutSummary, scopeNarrowed: boolean): boolean {
  if (scopeNarrowed) return false;
  return summary.distinctQueries !== null && summary.eventCount !== null;
}

/**
 * The run-set match count, or `null` when the server is not speaking for what
 * the table shows. Decided here so the two notes below and the headline can
 * never disagree about whose population they describe.
 */
export function selectionMatchedQueries(
  summary: FanoutSummary,
  scopeNarrowed: boolean,
): number | null {
  return isSelectionWide(summary, scopeNarrowed) ? summary.matchedQueries : null;
}

/**
 * Compact totals beside the grouping control, and the scope they describe.
 *
 * They come from the server's aggregation over the COMPLETE selection, so they
 * hold still while the reader pages and types. They used to be derived from
 * whichever evidence window happened to be loaded and shown under these same
 * labels, so they moved on every page.
 *
 * When `selectionWide` is false the server cannot speak for what the table
 * shows, so the figures come from the loaded window instead and the caption
 * changes with them. Selection labels over page numbers is the exact fault
 * this block was written to remove.
 */
export function FanoutCounts({
  summary,
  fallback,
  selectionWide,
}: Readonly<{
  summary: FanoutSummary;
  fallback: { distinct: number; occurrences: number };
  selectionWide: boolean;
}>) {
  const distinct = selectionWide ? (summary.distinctQueries ?? 0) : fallback.distinct;
  const occurrences = selectionWide ? (summary.eventCount ?? 0) : fallback.occurrences;
  const scope = selectionWide ? 'across the selected run set' : 'in the searches shown below';
  return (
    <span
      className={textRole('label', 'text-secondary whitespace-nowrap')}
      aria-label={`${distinct} distinct searches and ${occurrences} total occurrences ${scope}`}
      title={scope}
    >
      <span className="text-foreground tabular-nums">{distinct}</span>{' '}
      {distinct === 1 ? 'search' : 'searches'} ·{' '}
      <span className="text-foreground tabular-nums">{occurrences}</span> occurrences
    </span>
  );
}

/** How many searches the typed filter matches across the whole run set. */
export function SearchScopeNote({
  search,
  matched,
}: Readonly<{ search: string | null; matched: number | null }>) {
  if (!search || matched == null) return null;
  const noun = matched === 1 ? 'search' : 'searches';
  return (
    <span className={textRole('label', 'text-secondary')}>
      {matched === 0
        ? 'No searches match in this run set'
        : `${matched} matching ${noun} in this run set`}
    </span>
  );
}

/**
 * Nothing on THIS page matched — which is not the same as nothing matching.
 *
 * The table renders one loaded window. When the server reports matches the
 * window does not contain, say so rather than claiming the query does not
 * exist. Where those matches sit is not something this knows — the server
 * counts them across the whole selection, not relative to the loaded page — so
 * the wording stays neutral instead of pointing at a pager that may not be
 * showing.
 */
export function NoSearchMatch({
  search,
  matched,
}: Readonly<{ search: string | null; matched: number | null }>) {
  const verb = matched === 1 ? 'match sits' : 'matches sit';
  const elsewhere = matched ? ` — ${matched} ${verb} elsewhere in the run set.` : '.';
  return (
    <InlineEmpty className="p-[var(--card-padding)]">
      {`No search matches “${search}” on this page${elsewhere}`}
    </InlineEmpty>
  );
}
