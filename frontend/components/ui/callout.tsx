import type { ReactNode } from 'react';

import { Icon } from '@/components/ui/icon';
import { AlertTriangle, CheckCircle2, Info, XCircle, type IconGlyph } from '@/lib/icons';
import { cn } from '@/lib/utils';

export type CalloutTone = 'neutral' | 'info' | 'positive' | 'warning' | 'negative';

const TONE: Record<CalloutTone, { box: string; title: string; icon: IconGlyph; word: string }> = {
  neutral: {
    box: 'surface-inset text-ink-2',
    title: 'text-ink',
    icon: Info,
    word: 'Note',
  },
  info: { box: 'bg-info-wash text-info', title: '', icon: Info, word: 'Info' },
  positive: {
    box: 'bg-positive-wash text-positive',
    title: '',
    icon: CheckCircle2,
    word: 'Success',
  },
  warning: { box: 'bg-warning-wash text-warning', title: '', icon: AlertTriangle, word: 'Warning' },
  negative: { box: 'bg-negative-wash text-negative', title: '', icon: XCircle, word: 'Error' },
};

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
  children?: ReactNode;
  action?: ReactNode;
  icon?: IconGlyph;
  className?: string;
}>) {
  if (children == null && title == null) return null;
  const style = TONE[tone];
  const word = <span className="sr-only">{`${style.word}: `}</span>;
  const urgent = tone === 'negative' || tone === 'warning';
  const Root = urgent ? 'div' : 'output';
  return (
    <Root
      role={urgent ? 'alert' : undefined}
      data-callout-tone={tone}
      className={cn(
        'flex items-start gap-2 rounded-control border border-transparent px-4 py-3 text-body-sm',
        style.box,
        className,
      )}
    >
      <span aria-hidden className="inline-flex h-5 shrink-0 items-center">
        <Icon icon={icon ?? style.icon} className="my-0" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
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
