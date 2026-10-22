import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

/** Shared editorial structures for authenticated analytical workspaces. */

/**
 * The hairline band: a row of peers separated by rules rather than boxed
 * individually. `MetricGroup` is the `<dl>` flavour for label/value pairs;
 * these classes are the same recipe for bands whose cells are not `dt`/`dd`
 * (a score ring, an icon header with an action) and so cannot live in a `<dl>`.
 *
 * The caller supplies the column count — `desktop:grid-cols-3` — at the
 * product's one breakpoint, where the band becomes one row. Pairing the edge
 * padding with that same breakpoint is what keeps the first and last cells
 * flush with the page margin.
 */
export const hairlineBandClasses =
  'divide-border-subtle grid divide-y desktop:divide-x desktop:divide-y-0';

export const hairlineBandItemClasses =
  'min-w-0 py-3 desktop:px-4 desktop:first:ps-0 desktop:last:pe-0';

/**
 * The sanctioned two-column splits. A screen picks a role, never a ratio:
 * pages had drifted to 2fr/1fr, 3fr/2fr, 1.15fr/1fr and fixed rem widths for
 * the same two layouts, so the same kind of page moved its seam on every route.
 *
 *   `list-detail` — a selectable list beside the selected item's evidence.
 *   `main-aside`  — the primary surface beside supporting context.
 *   `peers`       — two equal surfaces read side by side (e.g. two tables).
 *
 * All stack below the `desktop` breakpoint, with the first child first, and
 * share the workspace gap. Columns align to the top so a short aside never
 * stretches.
 */
const SPLIT_PANE = {
  'list-detail': 'desktop:grid-cols-[var(--pane-list-detail)]',
  /**
   * The list at the reader's width: three tracks — the list at
   * `--split-pane-list-width`, the separator, the detail — with the gap carried
   * by the separator itself. `ResizableSplitPane` owns the width and the
   * separator; use it rather than this role alone.
   */
  'list-detail-resizable':
    'desktop:grid-cols-[var(--split-pane-list-width)_auto_minmax(0,1fr)] desktop:gap-0',
  'main-aside': 'desktop:grid-cols-[var(--pane-main-aside)]',
  peers: 'desktop:grid-cols-2',
} as const;

export type SplitPaneRole = keyof typeof SPLIT_PANE;

export function splitPaneClasses(role: SplitPaneRole, className?: string) {
  return cn('grid min-w-0 items-start gap-[var(--workspace-gap)]', SPLIT_PANE[role], className);
}

/**
 * The one sticky offset for a pane that stays in view while its neighbour
 * scrolls (the list beside a long detail). It clears the compact topbar on
 * narrow screens and is 0 on desktop, where the sheet scrolls under nothing.
 * The pane scrolls inside itself once it is taller than the viewport, so a
 * long list never pins its own end out of reach.
 */
export const stickyPaneClasses =
  'desktop:sticky desktop:top-[var(--sticky-header-offset)] desktop:max-h-[calc(100dvh-var(--sticky-header-offset)-2*var(--workspace-gap))] desktop:overflow-y-auto';

/**
 * The ledger: a vertical list of peers separated by rules rather than boxed
 * individually. Six different wrappers existed for this one idea — borderless,
 * hung off a rule, and boxed at two different radii — so the same list of
 * evidence rows looked like a different component on each screen.
 *
 *   `open`  — the list sits on whatever surface already contains it; rows are
 *             divided, the list itself is never outlined.
 *   `boxed` — a standalone object with its own fill and edge (a card).
 */
const LEDGER_SHELL = {
  open: '',
  boxed: 'surface-panel bg-panel border-border overflow-hidden rounded-[var(--radius-card)] border',
} as const;

export type LedgerShell = keyof typeof LEDGER_SHELL;

export function ledgerClasses(shell: LedgerShell = 'open', className?: string) {
  return cn('divide-border-subtle grid divide-y', LEDGER_SHELL[shell], className);
}
export function MetricGroup({
  children,
  className,
  ...props
}: Readonly<ComponentPropsWithoutRef<'dl'>>) {
  return (
    <dl
      {...props}
      className={cn(
        // One row from the desktop breakpoint: the sheet beside a 224px rail
        // is still ~700px wide at a 981px desktop, room for five figures.
        // Below it the figures stack, so no two-column grid strands an odd
        // figure beside an empty cell.
        'divide-border-subtle grid divide-y',
        'desktop:grid-flow-col desktop:auto-cols-fr desktop:divide-x desktop:divide-y-0',
        className,
      )}
    >
      {children}
    </dl>
  );
}

/**
 * One cell of a `MetricGroup`. The edge padding is paired with the breakpoint
 * the group reflows at, so the first and last cells stay flush with the card's
 * own padding. Exported because a band whose
 * cell is not a plain label/value pair still has to sit on this grid. The cell
 * owns its label → value rhythm (the 4px `tight` rung), so its children never
 * carry margins.
 */
export const metricItemClasses =
  'grid min-w-0 content-start gap-1 px-0 py-3 desktop:px-4 desktop:first:ps-0 desktop:last:pe-0';

export function MetricItem({
  label,
  value,
  detail,
  marker,
  className,
}: Readonly<{
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  marker?: ReactNode;
  className?: string;
}>) {
  return (
    <div className={cn(metricItemClasses, className)}>
      <dt className={textRole('label', 'flex min-w-0 items-center justify-between gap-2')}>
        <span className="truncate">{label}</span>
        {marker}
      </dt>
      <dd className={textRole('figure')}>{value}</dd>
      {detail ? <dd className={textRole('caption')}>{detail}</dd> : null}
    </div>
  );
}

/**
 * The section header for an authenticated screen: an optional meta label, the
 * title, one line of description, and the section's actions on the same row.
 *
 * Sections are separated by the page's section gap, never by a rule above the
 * header.
 */
export function EditorialSectionHeader({
  title,
  headingId,
  description,
  actions,
  className,
}: Readonly<{
  title: ReactNode;
  /** Target for the section's `aria-labelledby`. */
  headingId?: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}>) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="grid gap-1">
        <h2 id={headingId} className={textRole('sectionTitle')}>
          {title}
        </h2>
        {description ? <p className={textRole('body', 'max-w-[72ch]')}>{description}</p> : null}
      </div>
      {actions}
    </header>
  );
}
