import type { HTMLAttributes, ReactNode } from 'react';

import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

export type StatusTone = 'neutral' | 'positive' | 'negative' | 'warning' | 'info' | 'you';

const TONE_DOT: Record<StatusTone, string> = {
  neutral: 'bg-ink-2',
  positive: 'bg-positive',
  negative: 'bg-negative',
  warning: 'bg-warning',
  info: 'bg-info',
  you: 'bg-accent',
};

type Glyph = 'dot' | 'live' | Readonly<{ bars: 1 | 2 | 3 }>;

type Mark = Readonly<{ tone: StatusTone; glyph: Glyph }>;
const mark = (tone: StatusTone, glyph: Glyph = 'dot'): Mark => ({ tone, glyph });

const statusMarks = {
  success: mark('positive'),
  warning: mark('warning'),
  danger: mark('negative'),
  info: mark('info'),
} as const satisfies Record<string, Mark>;

const sentimentMarks = {
  positive: mark('positive'),
  neutral: mark('neutral'),
  negative: mark('negative'),
  mixed: mark('warning'),
} as const satisfies Record<string, Mark>;

const classificationMarks = {
  owned: mark('you'),
  competitor: mark('neutral'),
  'third-party': mark('neutral'),
} as const satisfies Record<string, Mark>;

const runStatusMarks = {
  draft: mark('neutral'),
  queued: mark('info'),
  running: mark('info', 'live'),
  paused: mark('neutral'),
  analyzing: mark('info', 'live'),
  completed: mark('positive'),
  partial: mark('warning'),
  failed: mark('negative'),
  cancelled: mark('warning'),
} as const satisfies Record<string, Mark>;

const severityMarks = {
  critical: mark('negative'),
  high: mark('negative'),
  medium: mark('warning'),
  low: mark('neutral'),
  info: mark('neutral'),
} as const satisfies Record<string, Mark>;

const priorityMarks = {
  high: mark('negative', { bars: 3 }),
  medium: mark('neutral', { bars: 2 }),
  low: mark('neutral', { bars: 1 }),
} as const satisfies Record<string, Mark>;

export type StatusValue = keyof typeof statusMarks;
export type PriorityValue = keyof typeof priorityMarks;
export type SentimentValue = keyof typeof sentimentMarks;
export type ClassificationValue = keyof typeof classificationMarks;
export type RunStatusValue = keyof typeof runStatusMarks;
type SeverityValue = keyof typeof severityMarks;

export type StatusMarkProps = {
  children: ReactNode;
  className?: string;
} & (
  | { variant: 'status'; value: StatusValue }
  | { variant: 'severity'; value: SeverityValue }
  | { variant: 'sentiment'; value: SentimentValue }
  | { variant: 'classification'; value: ClassificationValue }
  | { variant: 'run-status'; value: RunStatusValue }
  | { variant: 'priority'; value: PriorityValue }
  | { variant?: undefined; value?: undefined; tone?: StatusTone }
) &
  Omit<HTMLAttributes<HTMLSpanElement>, 'children'>;

function markOf(props: StatusMarkProps): Mark {
  switch (props.variant) {
    case 'status':
      return statusMarks[props.value];
    case 'severity':
      return severityMarks[props.value];
    case 'sentiment':
      return sentimentMarks[props.value];
    case 'classification':
      return classificationMarks[props.value];
    case 'run-status':
      return runStatusMarks[props.value];
    case 'priority':
      return priorityMarks[props.value];
    case undefined:
      return mark(props.tone ?? 'neutral');
    default: {
      const unreachable: never = props;
      return unreachable;
    }
  }
}

function MarkGlyph({ tone, glyph }: Mark) {
  if (glyph === 'live') return <Spinner />;
  if (glyph === 'dot')
    return <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', TONE_DOT[tone])} />;
  return <PriorityBars filled={glyph.bars} tone={tone} />;
}

const PRIORITY_BARS = [
  { x: 2, height: 4 },
  { x: 7, height: 8 },
  { x: 12, height: 12 },
] as const;

function PriorityBars({ filled, tone }: Readonly<{ filled: 1 | 2 | 3; tone: StatusTone }>) {
  return (
    <svg
      aria-hidden
      width={16}
      height={16}
      viewBox="0 0 16 16"
      className={cn('shrink-0', tone === 'negative' && 'text-negative')}
    >
      {PRIORITY_BARS.map((bar, index) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={14 - bar.height}
          width={3}
          height={bar.height}
          rx={0.5}
          className={index < filled ? 'fill-current' : 'fill-control-line'}
        />
      ))}
    </svg>
  );
}

export function StatusMark(props: Readonly<StatusMarkProps>) {
  const {
    children,
    className,
    variant: _variant,
    value: _value,
    tone: _tone,
    ...attributes
  } = { tone: undefined, ...props };
  const statusMark = markOf(props);
  return (
    <span
      {...attributes}
      data-status-tone={statusMark.tone}
      className={cn(
        'type-caption text-ink inline-flex h-5 shrink-0 items-center gap-1.5 align-middle font-medium whitespace-nowrap',
        typeof statusMark.glyph === 'object' && 'border-rule rounded-full border px-2',
        className,
      )}
    >
      <MarkGlyph {...statusMark} />
      <span>{children}</span>
    </span>
  );
}
