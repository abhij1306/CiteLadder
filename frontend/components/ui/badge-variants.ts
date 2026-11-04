/**
 * Badge token maps. Each family maps a value → the colour of the badge's
 * status dot, the label ink, and (where the design contract calls for it) a
 * quiet semantic fill. No raw hex; all classes resolve to the semantic
 * Tailwind declarations in globals.css.
 *
 * Colour never carries the state alone: the dot provides the quick visual cue
 * and the label names the meaning. Status and sentiment families may add the
 * documented quiet fill while classification and run-state rows stay lighter.
 *
 * The dot class is a separate field rather than a `[&>span]:bg-*` variant on the
 * wrapper: a child selector matches ANY direct span, and several call sites wrap
 * their own label in one (prompt-table, measurement-context), which would paint
 * a block behind the text. Badge owns the dot element, so Badge applies the class.
 *
 * Families:
 *  - status:         success | warning | danger | info
 *  - sentiment:      positive | neutral | negative | mixed
 *  - classification: owned | competitor | third-party  (citation classification)
 *  - run-status:     draft | queued | running | analyzing | completed | partial | failed | cancelled
 *  - neutral:        the default chip
 */

export type BadgeTone = { label: string; dot: string };

export const statusBadge = {
  success: { label: 'bg-success-bg text-success-text', dot: 'bg-success' },
  warning: { label: 'bg-warning-bg text-warning-text', dot: 'bg-warning' },
  danger: { label: 'bg-danger-bg text-danger-text', dot: 'bg-danger' },
  info: { label: 'bg-info-bg text-info-text', dot: 'bg-info' },
} as const satisfies Record<string, BadgeTone>;

export const sentimentBadge = {
  positive: statusBadge.success,
  neutral: {
    label: 'bg-neutral-bg text-secondary',
    dot: 'bg-neutral',
  },
  negative: statusBadge.danger,
  mixed: statusBadge.warning,
} as const satisfies Record<string, BadgeTone>;

export const classificationBadge = {
  owned: { label: 'text-secondary', dot: 'bg-citation-owned' },
  competitor: { label: 'text-secondary', dot: 'bg-citation-competitor' },
  'third-party': { label: 'text-secondary', dot: 'bg-citation-third-party' },
} as const satisfies Record<string, BadgeTone>;

export const neutralBadge = { label: 'bg-neutral-bg text-secondary', dot: 'bg-neutral' } as const;

// A run's state is the same badge wherever it shows (owner review,
// 2026-11-03): a summary line and a table cell both draw the outcome scale's
// filled badge, so "Completed" never reads grey in one place and green in
// another.
export const runStatusBadge = {
  draft: neutralBadge,
  queued: neutralBadge,
  running: statusBadge.info,
  paused: neutralBadge,
  analyzing: statusBadge.info,
  completed: statusBadge.success,
  partial: statusBadge.warning,
  failed: statusBadge.danger,
  cancelled: neutralBadge,
} as const satisfies Record<string, BadgeTone>;

export type StatusValue = keyof typeof statusBadge;
export type SentimentValue = keyof typeof sentimentBadge;
export type ClassificationValue = keyof typeof classificationBadge;
export type RunStatusValue = keyof typeof runStatusBadge;

/**
 * Shared compact shape/typography for every badge family. Casing comes from the
 * call site so product nouns keep their capitalization.
 */
export const badgeBase =
  'type-badge inline-flex min-h-[var(--badge-height-sm)] shrink-0 items-center gap-2 rounded-[var(--radius-xs)] px-2 py-0.5 whitespace-nowrap';

/**
 * A link whose face is a badge (a cited-evidence group that opens its
 * screen): the focus ring follows the badge's corners and the label
 * underlines on hover, so it reads as a link without becoming a control.
 */
export const badgeLinkClasses = 'rounded-[var(--radius-xs)] underline-offset-2 hover:underline';
