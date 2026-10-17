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
 * Size carries the hierarchy; weight only separates reading text from
 * everything else: 400 for sentences and captions, 500 for titles, figures,
 * labels and controls. Ink steps from `foreground` (titles, values) through
 * `secondary` (sentences, labels) to `muted` (captions, meta): three inks only.
 * The sizes below are the `.type-*` recipes in globals.css (size/leading in px).
 */
const TEXT_ROLES = {
  /** The route `h1`. 20/28, 500, −0.01em, foreground, display face. One per page. */
  pageTitle: 'type-page-title',
  /** A section, card, drawer or dialog heading. 16/24, 500, −0.011em, foreground. */
  sectionTitle: 'type-section-title',
  /** The title of a row, list item or insight. 14/20, 500, −0.006em, foreground. */
  itemTitle: 'type-item-title',
  /** Sentences: descriptions, prose, table cell text. 14/20, 400, secondary. */
  body: 'type-body',
  /** Buttons, navigation, tabs, links. 14/20, 500; ink comes from state. */
  control: 'type-control',
  /** Names a value: metric, field and column labels. 14/20, 500, secondary. */
  label: 'type-label',
  /** Timestamps, counts, help, footnotes. 12/16, 400, muted. */
  caption: 'type-caption',
  /** A metric value. 24/32, 500, −0.02em, foreground, tabular, text face. */
  figure: 'type-figure',
  /** A value inside a dense row or cell. 16/24, 500, foreground, tabular. */
  figureSm: 'type-figure-sm',
  /** A change indicator. 12/16, 500, tabular; the caller supplies the tone. */
  delta: 'type-delta',
  /** Badges, chips, segment labels, counts, key hints. 12/16, 500; the tone supplies the ink. */
  badge: 'type-badge',
  /** A value or name inside text that owns its size: 500, foreground. */
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

/** Primary numeral with tabular figures — the `figure` role. */
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
