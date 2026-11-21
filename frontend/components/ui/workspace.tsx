import type { ReactNode } from 'react';

import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';
import { POP_FACE } from '@/components/ui/slip';

export function ledgerClasses(className?: string) {
  return cn('divide-rule grid divide-y', className);
}

export function ledgerItemClasses(className?: string) {
  return cn('min-w-0 py-3 first:pt-0 last:pb-0', className);
}

export function insetClasses(className?: string) {
  return cn('surface-inset grid min-w-0 gap-1 rounded-control px-4 py-3', className);
}

export function treeBranchClasses(className?: string) {
  return cn('border-rule grid min-w-0 gap-2 border-l pl-4', className);
}

export function MetaFooter({
  children,
  trailing,
}: Readonly<{ children: ReactNode; trailing?: ReactNode }>) {
  if (!trailing)
    return (
      <footer className="type-caption border-rule flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3">
        {children}
      </footer>
    );
  return (
    <footer className="type-caption border-rule flex flex-wrap items-center justify-between gap-2 border-t pt-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">{children}</div>
      {trailing}
    </footer>
  );
}

export function SubsectionHeader({
  title,
  description,
  trailing,
  headingId,
}: Readonly<{
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  headingId?: string;
}>) {
  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span id={headingId} className={textRole('body', 'text-ink-2')}>
          {title}
        </span>
        {trailing}
      </div>
      {description ? <p className="type-caption">{description}</p> : null}
    </div>
  );
}

export function EditorialSectionHeader({
  title,
  headingId,
  description,
  actions,
  className,
}: Readonly<{
  title: ReactNode;
  headingId?: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}>) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="grid gap-1">
        <h2 id={headingId} className={textRole('heading')}>
          {title}
        </h2>
        {description ? (
          <p className={textRole('body', 'text-ink-2 max-w-[72ch]')}>{description}</p>
        ) : null}
      </div>
      {actions}
    </header>
  );
}

export function FloatingToolbar({ children }: Readonly<{ children: ReactNode }>) {
  return <div className={cn(POP_FACE, 'absolute end-3 top-3 z-10 flex gap-1 p-1')}>{children}</div>;
}
