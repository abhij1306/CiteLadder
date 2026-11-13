import type { HTMLAttributes, ReactNode } from 'react';
import { SignalHigh, SignalLow, SignalMedium, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * The system's badge tones (Badge README): `neutral` for categories, `accent`
 * for your own brand or "New", `positive` / `negative` / `warning` / `info`
 * for state, `ink` for a count that needs weight. No other tone exists.
 */
export type BadgeTone = 'neutral' | 'accent' | 'positive' | 'negative' | 'warning' | 'info' | 'ink';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-ink-secondary',
  accent: 'bg-accent-soft text-accent-ink',
  positive: 'bg-positive-soft text-positive',
  negative: 'bg-negative-soft text-negative',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-info-soft text-info',
  ink: 'bg-ink text-on-ink',
};

/*
 * Domain families resolve a product value to one system tone, so the same
 * state reads the same badge wherever it shows. The word always names the
 * state; the tone repeats it (WCAG 1.4.1).
 */
const statusTone = {
  success: 'positive',
  warning: 'warning',
  danger: 'negative',
  info: 'info',
} as const satisfies Record<string, BadgeTone>;

const sentimentTone = {
  positive: 'positive',
  neutral: 'neutral',
  negative: 'negative',
  mixed: 'warning',
} as const satisfies Record<string, BadgeTone>;

/** Citation classification: your own pages are the accent; everyone else is neutral. */
const classificationTone = {
  owned: 'accent',
  competitor: 'neutral',
  'third-party': 'neutral',
} as const satisfies Record<string, BadgeTone>;

const runStatusTone = {
  draft: 'neutral',
  queued: 'neutral',
  running: 'info',
  paused: 'neutral',
  analyzing: 'info',
  completed: 'positive',
  partial: 'warning',
  failed: 'negative',
  cancelled: 'neutral',
} as const satisfies Record<string, BadgeTone>;

/**
 * Priority is an order, not a state: High takes the accent tint, Medium and
 * Low stay neutral, and a signal glyph of three, two or one bars tells the
 * three apart without colour (owner, 2026-11-06). Red stays reserved for
 * errors and destructive actions.
 */
const priorityTone = {
  high: 'accent',
  medium: 'neutral',
  low: 'neutral',
} as const satisfies Record<string, BadgeTone>;

const PRIORITY_ICON = {
  high: SignalHigh,
  medium: SignalMedium,
  low: SignalLow,
} as const satisfies Record<keyof typeof priorityTone, LucideIcon>;

export type StatusValue = keyof typeof statusTone;
export type PriorityValue = keyof typeof priorityTone;
export type SentimentValue = keyof typeof sentimentTone;
export type ClassificationValue = keyof typeof classificationTone;
export type RunStatusValue = keyof typeof runStatusTone;

/**
 * The badge face: 22px, 8px padding, `radius-xs`, 12/16 medium. Centred on
 * the line it sits in: a badge that leads with an icon would otherwise take
 * the icon's bottom edge as its baseline and stretch a 40px table row. It
 * sets its own family and tracking, so a badge inside a figure (a StatRow
 * value) never inherits the figure's tight tracking.
 */
const BADGE_FACE =
  'inline-flex h-[var(--badge-height-sm)] max-w-full shrink-0 items-center gap-1 rounded-xs px-2 align-middle font-sans text-caption tracking-normal whitespace-nowrap';

export type BadgeProps = {
  children: ReactNode;
  className?: string;
  /** A 6px dot in the badge's ink before the word. */
  dot?: boolean;
} & (
  | { variant: 'status'; value: StatusValue }
  | { variant: 'sentiment'; value: SentimentValue }
  | { variant: 'classification'; value: ClassificationValue }
  | { variant: 'run-status'; value: RunStatusValue }
  | { variant: 'priority'; value: PriorityValue }
  | { variant?: undefined; value?: undefined; tone?: BadgeTone }
) &
  Omit<HTMLAttributes<HTMLSpanElement>, 'children'>;

function badgeTone(props: BadgeProps): BadgeTone {
  switch (props.variant) {
    case 'status':
      return statusTone[props.value];
    case 'sentiment':
      return sentimentTone[props.value];
    case 'classification':
      return classificationTone[props.value];
    case 'run-status':
      return runStatusTone[props.value];
    case 'priority':
      return priorityTone[props.value];
    default:
      return props.tone ?? 'neutral';
  }
}

/**
 * Badge — one or two words of status or category beside a name, on a soft
 * tint with its matching text colour. A neutral badge in a selected table row
 * lifts to `surface` with a `line` edge (the row is `surface-sunken`).
 */
export function Badge(props: Readonly<BadgeProps>) {
  // Strip the styling props so they never reach the DOM; forward every
  // other HTML attribute (id, aria-*, …) to the span.
  const {
    children,
    className,
    dot = false,
    variant: _variant,
    value: _value,
    tone: _tone,
    ...attributes
  } = { tone: undefined, ...props };
  const tone = badgeTone(props);
  const PriorityIcon = props.variant === 'priority' ? PRIORITY_ICON[props.value] : null;
  return (
    <span {...attributes} data-badge-tone={tone} className={cn(BADGE_FACE, TONE[tone], className)}>
      {dot ? <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden /> : null}
      {PriorityIcon ? <PriorityIcon className="size-3.5 shrink-0" aria-hidden /> : null}
      {children}
    </span>
  );
}
