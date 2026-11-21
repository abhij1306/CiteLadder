import type { ReactNode } from 'react';

import { useDocumentTitle } from '@/components/layout/use-route-announcement';
import { Icon } from '@/components/ui/icon';
import { SLIP_FACE } from '@/components/ui/slip';
import { StateBlock } from '@/components/ui/state-block';
import { textRole } from '@/components/ui/typography';
import { CircleAlert, Info, TriangleAlert, type IconGlyph } from '@/lib/icons';
import { cn } from '@/lib/utils';

import { PageFrame } from './page-frame';

/**
 * The one card a page outside the shell draws on the ground: Flow, Setup and
 * the full-page Notice. It lives here because the Notice loads eagerly.
 */
export const FLOW_CARD = cn(SLIP_FACE, 'p-6');

type NoticeTone = 'info' | 'warning' | 'negative' | 'loading';

const TONE: Readonly<
  Record<Exclude<NoticeTone, 'loading'>, readonly [glyph: IconGlyph, ink: string, word: string]>
> = {
  info: [Info, 'text-info', 'Notice'],
  warning: [TriangleAlert, 'text-warning', 'Warning'],
  negative: [CircleAlert, 'text-negative', 'Error'],
};

type NoticeContent = Readonly<{
  tone: NoticeTone;
  heading: string;
  icon?: IconGlyph;
  label?: string | null;
  children?: ReactNode;
  actions?: ReactNode;
}>;

function NoticeBlock({
  tone,
  heading,
  icon,
  label,
  children,
  actions,
}: Omit<NoticeContent, 'heading'> & Readonly<{ heading: string | null }>) {
  // One loader for a wait that passes through several owners: it hands over without a blank beat.
  if (tone === 'loading')
    return <StateBlock kind="loading" label={heading ?? undefined} shape={{ kind: 'list' }} />;
  const [glyph, ink, word] = TONE[tone];
  const mark = <Icon icon={icon ?? glyph} className={ink} />;
  return (
    <section
      data-notice-tone={tone}
      className={cn('flex w-full flex-col gap-4', heading && FLOW_CARD)}
    >
      {label === null ? null : <p className={textRole('captionStrong')}>{label ?? word}</p>}
      <div className="flex flex-col gap-2">
        {heading ? (
          <div className="flex items-start gap-2">
            <span className="flex h-7 items-center">{mark}</span>
            <h1 className={textRole('title', 'min-w-0 text-balance')}>{heading}</h1>
          </div>
        ) : null}
        {children ? (
          <div className="flex items-start gap-2">
            {heading ? null : mark}
            <div className={textRole('body', 'flex max-w-[72ch] min-w-0 flex-col gap-2')}>
              {children}
            </div>
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </section>
  );
}

export function NoticePage({ heading, ...notice }: NoticeContent) {
  const loading = notice.tone === 'loading';
  return (
    <PageFrame title={loading ? undefined : heading}>
      <NoticeBlock {...notice} heading={loading ? heading : null} />
    </PageFrame>
  );
}

export function NoticeScreen(notice: NoticeContent) {
  useDocumentTitle(notice.tone === 'loading' ? undefined : notice.heading);
  return (
    <div className="flex min-w-0 flex-col pt-[var(--flow-gap)]">
      <NoticeBlock {...notice} />
    </div>
  );
}
