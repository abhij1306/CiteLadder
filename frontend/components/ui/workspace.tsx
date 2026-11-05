import type { ReactNode } from 'react';

import { panelClasses } from '@/components/ui/panel';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

/**
 * Shared editorial structures for authenticated analytical workspaces. A row
 * of label/value facts is a `StatRow` (`stat-row.tsx`), not a recipe here.
 */

/**
 * The one sticky offset for a pane that stays in view while its neighbour
 * scrolls (the list beside a long detail). It sticks `workspace-gap` under
 * the app's sticky top bar (decision D12), never beneath it. The pane scrolls
 * inside itself once it is taller than the viewport, so a long list never
 * pins its own end out of reach.
 */
export const stickyPaneClasses =
  'desktop:sticky desktop:top-[calc(var(--sticky-header-offset)+var(--workspace-gap))] desktop:max-h-[calc(100dvh-var(--sticky-header-offset)-2*var(--workspace-gap))] desktop:overflow-y-auto';

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
  return cn('divide-line grid divide-y', shell === 'boxed' && panelClasses(), className);
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
  return cn('border-line grid min-w-0 gap-2 border-l pl-4', className);
}

/**
 * The provenance line that closes a block: when it was captured, where, by
 * what — caption facts on one wrapping line, 16 apart, under a hairline 12
 * above them. `trailing` (a status, a note) sits at the line's end and wraps
 * under the facts when the line is full.
 */
export function MetaFooter({
  children,
  trailing,
}: Readonly<{ children: ReactNode; trailing?: ReactNode }>) {
  if (!trailing)
    return (
      <footer className="type-caption border-line flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3">
        {children}
      </footer>
    );
  return (
    <footer className="type-caption border-line flex flex-wrap items-center justify-between gap-2 border-t pt-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">{children}</div>
      {trailing}
    </footer>
  );
}

/**
 * Who or what a screen or section is about: the 40px mark (a `BrandMark` at
 * its `header` placement or an `Avatar` at `profile`), the title, one caption line under
 * it, and the actions that act on it at the row's end, wrapping under the
 * text when the row is full. The page supplies the text in its roles; the
 * row owns the alignment and every gap.
 */
export function IdentityRow({
  media,
  title,
  caption,
  actions,
}: Readonly<{
  media: ReactNode;
  title: ReactNode;
  caption?: ReactNode;
  actions?: ReactNode;
}>) {
  return (
    <div
      data-identity-row=""
      className="flex min-w-0 flex-wrap items-center justify-between gap-[var(--compact-gap)]"
    >
      <div className="flex min-w-0 flex-1 items-center gap-[var(--compact-gap)]">
        {media}
        <div className="grid min-w-0 flex-1 gap-1">
          {title}
          {caption}
        </div>
      </div>
      {actions}
    </div>
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

/**
 * The editing controls that float over a widget's top-end corner while its
 * layout is being edited: a cluster of `IconButton`s lifted off the widget
 * like a menu (the menu surface and shadow), hugging the controls with a 4px
 * inset and 4 between them. Each control names the widget it acts on. The
 * widget it sits on must be `relative`.
 */
export function FloatingToolbar({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="bg-surface shadow-pop absolute end-3 top-3 z-10 flex gap-1 rounded-lg p-1">
      {children}
    </div>
  );
}
