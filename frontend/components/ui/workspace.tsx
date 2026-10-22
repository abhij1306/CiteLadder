import type { ReactNode } from 'react';

import { panelClasses } from '@/components/ui/panel';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

/**
 * Shared editorial structures for authenticated analytical workspaces. A row
 * of label/value facts is a `StatRow` (`stat-row.tsx`), not a recipe here.
 */

/**
 * The sanctioned two-column splits. A screen picks a role, never a ratio:
 * pages had drifted to 2fr/1fr, 3fr/2fr, 1.15fr/1fr and fixed rem widths for
 * the same two layouts, so the same kind of page moved its seam on every route.
 *
 *   `list-detail` — a selectable list beside the selected item's evidence.
 *   `main-aside`  — the primary surface beside supporting context.
 *   `peers`       — two equal surfaces read side by side (e.g. two tables).
 *   `thirds`      — three equal summary cards side by side.
 *
 * All stack below the `desktop` breakpoint, with the first child first, and
 * share the workspace gap. Columns align to the top so a short aside never
 * stretches. A detail route takes its split from `DetailScreen`.
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
  /** Three equal summary cards read side by side. */
  thirds: 'desktop:grid-cols-3',
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
 *   `boxed` — a standalone object: the one box recipe (`panelClasses`: radius
 *             12, the hairline edge, padding 16), its rows divided inside it.
 */
export type LedgerShell = 'open' | 'boxed';

export function ledgerClasses(shell: LedgerShell = 'open', className?: string) {
  return cn('divide-border-subtle grid divide-y', shell === 'boxed' && panelClasses(), className);
}

/**
 * One row of a ledger: 12 above and below the rule between rows, flush at
 * the list's own edges so the first and last rows meet the container's inset.
 * The row's inner layout (an `Inline` or a `Stack`) is the caller's anatomy;
 * the rhythm between rows is this recipe's.
 */
export function ledgerItemClasses(className?: string) {
  return cn('min-w-0 py-3 first:pt-0 last:pb-0', className);
}

/**
 * One level of a tree (a page hierarchy): its items 8 apart, hung off a
 * hairline and indented 16 from their parent, so depth reads as indentation
 * and the rule shows which parent a branch belongs to. Nest a branch inside
 * an item for the next level.
 */
export function treeBranchClasses(className?: string) {
  return cn('border-border-subtle grid min-w-0 gap-2 border-l pl-4', className);
}

/**
 * The provenance line that closes a block: when it was captured, where, by
 * what — caption facts on one wrapping line, 16 apart, under a hairline 12
 * above them.
 */
export function MetaFooter({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <footer className="type-caption border-border-subtle flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3">
      {children}
    </footer>
  );
}

/**
 * The heading of a block inside a section or card: a label, one line of
 * caption under it, and an optional trailing fact (a count) or control on the
 * label's row. The label/caption pair is 4 apart, like every label and the
 * value it names.
 */
export function SubsectionHeader({
  title,
  description,
  trailing,
  headingId,
}: Readonly<{
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  /** Target for the block's `aria-labelledby`. */
  headingId?: string;
}>) {
  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span id={headingId} className={textRole('label')}>
          {title}
        </span>
        {trailing}
      </div>
      {description ? <p className="type-caption">{description}</p> : null}
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
