import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/utils';

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

const BADGE_FACE =
  'inline-flex min-h-5.5 max-w-full shrink-0 items-center gap-0.5 rounded-xs px-2 align-middle font-sans text-caption tracking-normal whitespace-nowrap';

export type BadgeProps = {
  children: ReactNode;
  className?: string;
  dot?: boolean;
  tone?: BadgeTone;
} & Omit<HTMLAttributes<HTMLSpanElement>, 'children'>;

export function Badge({
  children,
  className,
  dot = false,
  tone = 'neutral',
  ...attributes
}: Readonly<BadgeProps>) {
  return (
    <span {...attributes} data-badge-tone={tone} className={cn(BADGE_FACE, TONE[tone], className)}>
      {dot ? <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}
