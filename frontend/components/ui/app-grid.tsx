import { createElement, type HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

/**
 * AppGrid — the app's only grids, so a page picks a layout instead of
 * setting columns or gaps. The gap is always the card gap (`workspace-gap`,
 * 12 in the app since decision D11) and cards in a
 * row stretch to one height.
 *
 * A KPI row is one row from 981px (decision D9: 4 across at the owner's 982px,
 * never 2 × 2, never 2 + 1) and one column on a phone:
 *
 *   `quarters`    — four equal (a KPI row).
 *   `fifths`      — five equal (a five-figure KPI row).
 *   `pair`        — two equal (a two-figure KPI row).
 *   `thirds`      — three equal: one row from 981px, never 2 + 1.
 *   `main-aside`  — 2fr + 1fr (a chart beside a ranked list or facts);
 *                   stacks below 1280px.
 *   `halves`      — two peers (usage and invoices); stack below 1280px.
 *   `list-detail` — a selectable list beside the selected item's evidence,
 *                   from 981px; the columns align to the top.
 *
 * Grids never nest a second AppGrid and never set widths on their children.
 */
const LAYOUT = {
  quarters: 'desktop:grid-cols-4',
  fifths: 'desktop:grid-cols-5',
  pair: 'desktop:grid-cols-2',
  thirds: 'desktop:grid-cols-3',
  'main-aside': 'shell:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]',
  halves: 'shell:grid-cols-2',
  'list-detail': 'desktop:grid-cols-[var(--pane-list-detail)] items-start',
} as const;

export type AppGridLayout = keyof typeof LAYOUT;

type GridElement = 'div' | 'ul' | 'ol' | 'dl' | 'section';

export function AppGrid({
  as = 'div',
  layout,
  className,
  children,
  ...props
}: Readonly<
  HTMLAttributes<HTMLElement> & {
    /** The grid's element, for the list or section it is. */
    as?: GridElement;
    layout: AppGridLayout;
    /** Owner-only: a `components/ui` organism's own extra classes. */
    className?: string;
  }
>) {
  return createElement(
    as,
    {
      ...props,
      'data-app-grid': layout,
      className: cn(
        'grid min-w-0 grid-cols-1 gap-[var(--workspace-gap)] *:min-w-0',
        LAYOUT[layout],
        className,
      ),
    },
    children,
  );
}
