import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * The closed set of product text roles.
 *
 * A call site names the *job* the text does and gets size, leading, weight,
 * tracking and ink from that job. The recipes live once, as `.type-*` classes
 * in `apps/app/src/globals.css`; this map only names them, so retuning a role
 * is one CSS edit and no call site changes.
 *
 * Size carries the hierarchy, then ink, and weight last (D49). Every role is
 * one of three text styles:
 * - heading: 500 in `ink`. Page, section, card, dialog and drawer titles, a
 *   metric's figure, buttons and the selected tab or nav item.
 * - primary: 400 in `ink`. What is read first in a row or a sentence: row and
 *   item titles, names, values, table cells, prose.
 * - secondary: 400 in the app's one grey. What supports it: descriptions,
 *   labels, column heads, captions, meta, counts, inactive tabs and nav.
 * `ink-muted` is an alias of `ink-secondary` (D50), so there are two inks. The sizes below are the `.type-*` recipes in globals.css
 * (size/leading in px).
 */
const TEXT_ROLES = {
  /** The route `h1`. 20/28 (D58), −0.01em, ink, display face at its one weight (D7, D11). One per page. */
  pageTitle: 'type-page-title',
  /** A section, card, drawer or dialog heading. 16/24, heading (500, ink). */
  sectionTitle: 'type-section-title',
  /** The title of a row, list item or insight. 14/20, primary (400, ink); 500 when set on an `h2`–`h6`. */
  itemTitle: 'type-item-title',
  /** Sentences: descriptions and supporting copy. 14/20, secondary (400, grey). */
  body: 'type-body',
  /** Navigation, tabs, links, list rows. 14/20, 400; ink and the selected 500 come from state. */
  control: 'type-control',
  /** Names a value: metric, fact and group labels. 14/20, secondary (400, grey). */
  label: 'type-label',
  /** Timestamps, counts, help, footnotes. 12/16, secondary (400, grey). */
  caption: 'type-caption',
  /** A metric value. 24/32 (D48), heading (500, ink), tabular digits. */
  figure: 'type-figure',
  /** A value inside a dense row or cell. 14/20, primary (400, ink), tabular digits. */
  figureSm: 'type-figure-sm',
  /** A change indicator. 12/16, 400, mono; the caller supplies the tone. */
  delta: 'type-delta',
  /** Badges, chips, segment labels, counts, key hints. 12/16, 400; the tone supplies the ink. */
  badge: 'type-badge',
  /** A value or name inside grey text that owns its size: primary (400, ink). */
  emphasis: 'type-emphasis',
} as const;

export type TextRole = keyof typeof TEXT_ROLES;

/** Resolve a text role, optionally merged with layout-only classes. */
export function textRole(role: TextRole, className?: string) {
  return cn(TEXT_ROLES[role], className);
}

/** A label naming a value — the `label` role. */
export function Label({
  children,
  className,
  ...props
}: Readonly<ComponentPropsWithoutRef<'span'>>) {
  return (
    <span {...props} className={textRole('label', className)}>
      {children}
    </span>
  );
}

/**
 * CodeToken — a literal the reader copies or types (a URL, a key prefix, a
 * command) set inline on the well tint: the `emphasis` role, 8 across and 4
 * down, the small radius, cut to one line. One form; the token owns its box.
 */
export function CodeToken({ children }: Readonly<{ children: string }>) {
  return (
    <code
      data-code-token=""
      className={textRole('emphasis', 'bg-surface-sunken min-w-0 truncate rounded-xs px-2 py-1')}
    >
      {children}
    </code>
  );
}

/**
 * InlineFigure — a number inside a line that owns its size and ink (a tab or
 * chip count, a summary line's total, an ID, "30 / 210"): the surrounding
 * role is kept and only the digits take the figure face. Feature screens use
 * this instead of setting the face themselves.
 */
export function InlineFigure({
  children,
  className,
  ...props
}: Readonly<ComponentPropsWithoutRef<'span'>>) {
  return (
    <span {...props} className={cn('font-mono', className)}>
      {children}
    </span>
  );
}

/** Primary numeral in the figure face — the `figure` role. */
export function Metric({
  children,
  className,
  ...props
}: Readonly<ComponentPropsWithoutRef<'span'>>) {
  return (
    <span {...props} className={textRole('figure', className)}>
      {children}
    </span>
  );
}
