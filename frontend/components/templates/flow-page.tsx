import { useId, type ReactNode } from 'react';

import { useDocumentTitle } from '@/components/layout/use-route-announcement';
import { Icon } from '@/components/ui/icon';
import { LogoMark } from '@/components/ui/logo-mark';
import { ThemeSwitch } from '@/components/ui/theme-switch';
import { textRole } from '@/components/ui/typography';
import type { IconGlyph } from '@/lib/icons';
import { websiteHref } from '@/lib/config/app-link';
import { cn } from '@/lib/utils';

import { FLOW_CARD } from './notice-page';

export function FlowLogo() {
  return (
    <a
      href={websiteHref('/')}
      aria-label="CiteLadder home"
      className="focus-ring text-ink rounded-control -ms-1 inline-flex p-1"
    >
      <LogoMark size={22} />
    </a>
  );
}

export function FlowPage({
  label,
  kicker = label,
  barEnd,
  footer,
  aside,
  children,
}: Readonly<{
  label: string;
  kicker?: string | null;
  barEnd?: ReactNode;
  footer?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}>) {
  return (
    <div
      className={cn(
        'text-ink grid min-h-dvh antialiased',
        aside ? 'bg-surface desktop:grid-cols-2' : 'bg-ground',
      )}
    >
      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="flex min-h-[var(--masthead-height)] shrink-0 items-center justify-between gap-[var(--card-padding)] px-[var(--content-gutter)]">
          <span className="inline-flex">
            <FlowLogo />
          </span>
          <div className="flex items-center gap-2">
            {barEnd}
            <ThemeSwitch />
          </div>
        </header>
        <main
          id="main"
          aria-label={label}
          className="max-w-flow mx-auto flex w-full flex-1 flex-col px-[var(--content-gutter)] pt-[max(var(--flow-gap),calc(20dvh-var(--masthead-height)))] pb-[var(--flow-gap)] [--control-md:var(--control-lg)]"
        >
          <div className={cn(!aside && FLOW_CARD, 'flex flex-col gap-4')}>
            {kicker === null ? null : <p className={textRole('captionStrong')}>{kicker}</p>}
            <div className="flex flex-col">{children}</div>
          </div>
        </main>
        {footer ? (
          <footer className={textRole('caption', 'px-[var(--content-gutter)] py-4 text-center')}>
            {footer}
          </footer>
        ) : null}
      </div>
      {aside}
    </div>
  );
}

function FlowHead({
  id,
  title,
  sub,
  icon,
  centered,
}: Readonly<{
  id: string;
  title: ReactNode;
  sub?: ReactNode;
  icon?: IconGlyph;
  centered?: boolean;
}>) {
  useDocumentTitle(typeof title === 'string' ? title : undefined);
  return (
    <header className={cn('flex flex-col gap-2', centered && 'items-center text-center')}>
      {icon ? <Icon icon={icon} className="text-ink-2" /> : null}
      <h1 id={id} tabIndex={-1} className={textRole('title', 'text-balance')}>
        {title}
      </h1>
      {sub ? <p className={textRole('body', 'text-ink-2')}>{sub}</p> : null}
    </header>
  );
}

export function FlowBlock({
  title,
  titleId,
  sub,
  icon,
  centered,
  after,
  children,
}: Readonly<{
  title: ReactNode;
  titleId?: string;
  sub?: ReactNode;
  icon?: IconGlyph;
  centered?: boolean;
  after?: ReactNode;
  children?: ReactNode;
}>) {
  const generatedId = useId();
  const headingId = titleId ?? generatedId;
  return (
    <div className="flex flex-col gap-[var(--page-top-gap)]">
      <section aria-labelledby={headingId} className="flex flex-col gap-[var(--page-top-gap)]">
        <FlowHead id={headingId} title={title} sub={sub} icon={icon} centered={centered} />
        {children}
      </section>
      {after ? (
        <div className={textRole('body', 'flex flex-col gap-4 text-ink-2')}>{after}</div>
      ) : null}
    </div>
  );
}
