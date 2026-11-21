import type { ReactNode, RefObject } from 'react';

import { cn } from '@/lib/utils';
import { SLIP_FACE } from '@/components/ui/slip';

const FILL = 'h-[calc(100dvh-var(--route-chrome-height))] min-h-0';
const COLUMN = cn('surface-card', SLIP_FACE, 'flex min-h-0 min-w-0 flex-col overflow-hidden');

export function EditorWorkspace({ page, rail }: Readonly<{ page: ReactNode; rail: ReactNode }>) {
  return (
    <div
      data-editor-workspace="wide"
      className={cn(
        FILL,
        'grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-[var(--workspace-gap)]',
      )}
    >
      {page}
      {rail}
    </div>
  );
}

export function EditorStack({
  tabs,
  children,
}: Readonly<{ tabs: ReactNode; children: ReactNode }>) {
  return (
    <div
      data-editor-workspace="narrow"
      className={cn(FILL, 'flex flex-col gap-[var(--page-band-gap)]')}
    >
      {tabs}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

export function EditorPane({
  label,
  head,
  children,
}: Readonly<{ label: string; head?: ReactNode; children: ReactNode }>) {
  return (
    <section aria-label={label} className={cn(COLUMN, 'flex-1')}>
      {head ? (
        <div className="border-rule grid gap-2 border-b px-[var(--card-padding)] py-3">{head}</div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </section>
  );
}

export function EditorRail({
  head,
  children,
  dock,
}: Readonly<{ head?: ReactNode; children?: ReactNode; dock?: ReactNode }>) {
  const panel = children != null;
  return (
    <div className={cn(COLUMN, 'flex-1')}>
      {head ? (
        <div className="px-[var(--card-padding)] pt-[var(--card-padding)]">{head}</div>
      ) : null}
      {panel ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-[var(--card-padding)]">
          {children}
        </div>
      ) : null}
      {dock ? (
        <div
          className={cn(
            'flex min-h-0 flex-col',
            panel ? 'border-rule max-h-[50%] shrink-0 border-t' : 'flex-1',
          )}
        >
          {dock}
        </div>
      ) : null}
    </div>
  );
}

export function EditorDock({
  label,
  scrollRef,
  children,
  composer,
}: Readonly<{
  label: string;
  scrollRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
  composer: ReactNode;
}>) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section
        ref={scrollRef}
        aria-label={label}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-[var(--compact-gap)]"
      >
        <div className="flex min-w-0 flex-col gap-[var(--workspace-gap)]">{children}</div>
      </section>
      <div className="shrink-0 px-[var(--compact-gap)] pb-[var(--compact-gap)]">{composer}</div>
    </div>
  );
}
