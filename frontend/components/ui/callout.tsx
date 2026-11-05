import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from 'lucide-react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

export type CalloutTone = 'neutral' | 'info' | 'positive' | 'warning' | 'negative';

/**
 * Each tone's fill, icon and the word a screen reader hears first. Text on a
 * status tint is that status colour (the pair its token names); neutral is
 * `surface-sunken` with an `ink` title and `ink-secondary` body.
 */
const TONE: Record<CalloutTone, { box: string; title: string; icon: LucideIcon; word: string }> = {
  neutral: {
    box: 'bg-surface-sunken text-ink-secondary',
    title: 'text-ink',
    icon: Info,
    word: 'Note',
  },
  info: { box: 'bg-info-soft text-info', title: '', icon: Info, word: 'Info' },
  positive: {
    box: 'bg-positive-soft text-positive',
    title: '',
    icon: CheckCircle2,
    word: 'Success',
  },
  warning: { box: 'bg-warning-soft text-warning', title: '', icon: AlertTriangle, word: 'Warning' },
  negative: { box: 'bg-negative-soft text-negative', title: '', icon: XCircle, word: 'Error' },
};

/**
 * Callout — an in-page message that stays until the condition changes: a
 * data caveat, a finished crawl, failed checks. `radius-md`, 12/16px padding,
 * the tone's 16px icon, 14/20 text with a 500-weight title, and one optional
 * action at the right. Say what is true, then what to do. Negative and
 * warning callouts are announced as alerts; the rest as status.
 */
export function Callout({
  tone = 'neutral',
  title,
  children,
  action,
  icon,
  className,
}: Readonly<{
  tone?: CalloutTone;
  title?: ReactNode;
  /** One or two sentences. */
  children?: ReactNode;
  /** A secondary Button or a TextLink. */
  action?: ReactNode;
  /** Overrides the tone's icon. */
  icon?: LucideIcon;
  className?: string;
}>) {
  if (children == null && title == null) return null;
  const style = TONE[tone];
  const word = <span className="sr-only">{`${style.word}: `}</span>;
  // A negative or warning callout interrupts (alert); the rest are a polite
  // status, which the native <output> carries.
  const urgent = tone === 'negative' || tone === 'warning';
  const Root = urgent ? 'div' : 'output';
  return (
    <Root
      role={urgent ? 'alert' : undefined}
      data-callout-tone={tone}
      className={cn(
        'flex items-start gap-3 rounded-md px-4 py-3 text-body-sm',
        style.box,
        className,
      )}
    >
      <span aria-hidden className="inline-flex h-5 shrink-0 items-center">
        <Icon icon={icon ?? style.icon} className="my-0" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title != null ? (
          <p className={cn('font-medium', style.title)}>
            {word}
            {title}
          </p>
        ) : (
          word
        )}
        {children != null ? <div>{children}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2 self-center">{action}</div> : null}
    </Root>
  );
}
