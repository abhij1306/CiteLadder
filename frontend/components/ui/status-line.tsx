import { Info } from 'lucide-react';

import { InfoHint } from '@/components/ui/info-hint';
import { Spinner } from '@/components/ui/spinner';
import { ICONS } from '@/lib/icons';
import { cn } from '@/lib/utils';

type StatusTone = 'info' | 'warning' | 'danger' | 'neutral';

/** One thing the screen has to say, most important first in the list. */
export type StatusMessage = Readonly<{
  key: string;
  tone: StatusTone;
  text: string;
  /** Work in flight: a spinner instead of the tone icon. */
  busy?: boolean;
}>;

const TONE_TEXT: Record<StatusTone, string> = {
  info: 'text-info',
  warning: 'text-warning',
  danger: 'text-negative',
  neutral: 'text-ink-muted',
};

const TONE_ICON = {
  info: Info,
  warning: ICONS.warning,
  danger: ICONS.danger,
  neutral: Info,
} as const;

/**
 * A screen's notices in ONE line that is always there.
 *
 * Banners that appear above content (a sync starting, a range still being
 * built, a coverage caveat) push the content down the moment they arrive and
 * pull it back up when they clear. This line keeps one control-height
 * footprint in every state: it shows the most important message, says how
 * many more there are behind a hint, and at rest shows the `resting` fact.
 * Long text truncates; the full sentence stays in the title and the DOM.
 */
export function StatusLine({
  messages,
  resting,
  testId,
}: Readonly<{
  messages: readonly StatusMessage[];
  /** Null keeps the line's height with nothing in it. */
  resting: string | null;
  testId?: string;
}>) {
  const [first, ...rest] = messages;
  const tone = first?.tone ?? 'neutral';
  const text = first?.text ?? resting;
  const ToneIcon = TONE_ICON[tone];
  if (!text) return <output data-testid={testId} className="h-[var(--control-md)]" />;
  return (
    <output
      data-testid={testId}
      data-status-tone={tone}
      className={cn(
        'type-caption flex h-[var(--control-md)] min-w-0 items-center gap-2',
        TONE_TEXT[tone],
      )}
    >
      {first?.busy ? <Spinner /> : <ToneIcon className="size-4 shrink-0" aria-hidden />}
      <span className="min-w-0 truncate" title={text}>
        {text}
      </span>
      {rest.length ? (
        <InfoHint label={`${rest.length} more ${rest.length === 1 ? 'notice' : 'notices'}`}>
          {rest.map((message) => message.text).join(' ')}
        </InfoHint>
      ) : null}
    </output>
  );
}
