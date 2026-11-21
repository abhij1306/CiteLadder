import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { SidebarTextTooltip } from '@/components/ui/sidebar';
import { Spinner } from '@/components/ui/spinner';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

export function HistoryList({
  search,
  more,
  children,
}: Readonly<{ search: ReactNode; more?: ReactNode; children: ReactNode }>) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {search}
      {children}
      {more}
    </div>
  );
}

export function HistoryNotice({ children }: Readonly<{ children: ReactNode }>) {
  return <p className={textRole('caption')}>{children}</p>;
}

export function HistoryFailed({ message, retry }: Readonly<{ message: string; retry: ReactNode }>) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 pl-3">
      <p className={textRole('body', 'text-ink-2 min-w-0')}>{message}</p>
      {retry}
    </div>
  );
}

export function HistoryRows({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <ul aria-label={label} className="flex flex-col">
      {children}
    </ul>
  );
}

export function HistoryRow({
  href,
  active,
  title,
  meta,
  working = false,
}: Readonly<{ href: string; active: boolean; title: string; meta: ReactNode; working?: boolean }>) {
  return (
    <li>
      <SidebarTextTooltip>
        <Link
          to={href}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'focus-ring rounded-control relative flex min-w-0 flex-col gap-0.5 px-3 py-2 transition-colors',
            'before:rounded-mark before:absolute before:inset-y-2 before:start-0 before:w-[var(--mark-width)]',
            active ? 'text-ink before:bg-accent' : 'text-ink-2 hover:overlay-hover hover:text-ink',
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span data-sidebar-text="title" className="type-label min-w-0 flex-1 truncate">
              {title}
            </span>
            {working ? <Spinner label="Working" /> : null}
          </span>
          <span data-sidebar-text="meta" className={textRole('caption', 'truncate')}>
            {meta}
          </span>
        </Link>
      </SidebarTextTooltip>
    </li>
  );
}
