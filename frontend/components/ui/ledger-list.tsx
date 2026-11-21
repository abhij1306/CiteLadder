import type { ReactNode } from 'react';

import { ClampText } from '@/components/ui/clamp-text';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

export function LedgerList({
  label,
  ordered = false,
  children,
}: Readonly<{
  label?: string;
  ordered?: boolean;
  children: ReactNode;
}>) {
  const List = ordered ? 'ol' : 'ul';
  return (
    <List aria-label={label} data-ledger-list="" className="grid min-w-0">
      {children}
    </List>
  );
}

export function LedgerItem({
  title,
  meta,
  caption,
  links,
  action,
}: Readonly<{
  title: ReactNode;
  meta?: ReactNode;
  caption?: ReactNode;
  links?: ReactNode;
  action?: ReactNode;
}>) {
  const text = (
    <>
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <ClampText className={textRole('body', 'flex-[1_1_15rem]')}>{title}</ClampText>
        {meta === undefined ? null : <div className="flex shrink-0 items-center gap-2">{meta}</div>}
      </div>
      {caption === undefined ? null : <ClampText className="type-caption">{caption}</ClampText>}
      {links === undefined ? null : (
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">{links}</div>
      )}
    </>
  );
  return (
    <li
      data-ledger-item=""
      className={cn(
        '-mx-3 min-w-0 px-3 py-2',
        action === undefined ? 'grid gap-1' : 'flex items-center gap-4',
        'hover:overlay-hover transition-colors duration-[var(--motion-fast)]',
      )}
    >
      {action === undefined ? (
        text
      ) : (
        <>
          <div className="grid min-w-0 flex-1 gap-1">{text}</div>
          <div className="shrink-0">{action}</div>
        </>
      )}
    </li>
  );
}
