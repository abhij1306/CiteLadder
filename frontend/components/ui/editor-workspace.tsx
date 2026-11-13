import type { ReactNode, RefObject } from 'react';

import { CARD_FACE } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * The editor workspace (the Agent's page workspace, E1): a document beside
 * its rail, filling the viewport below the header so the window never
 * scrolls; each column scrolls inside itself. Wide, the page takes 3fr and
 * the rail 2fr (60/40). Narrow, `EditorStack` puts the same parts under one
 * row of tabs. The route picks one form; the parts are the same.
 */
const FILL = 'h-[calc(100dvh-var(--route-chrome-height))] min-h-0';
// `surface-card` marks a container, so a panel inside it takes the inset fill.
const COLUMN = cn('surface-card', CARD_FACE, 'flex min-h-0 min-w-0 flex-col overflow-hidden');

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

/** The narrow form: `tabs` (a `TabRow` inside the caller's `TabsRoot`), then the open panel. */
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

/**
 * The document's column: a card whose head (its actions and notices) stays
 * while the document scrolls under it. The document pads itself.
 */
export function EditorPane({
  label,
  head,
  children,
}: Readonly<{ label: string; head?: ReactNode; children: ReactNode }>) {
  return (
    <section aria-label={label} className={cn(COLUMN, 'flex-1')}>
      {head ? (
        <div className="border-line grid gap-2 border-b px-[var(--card-padding)] py-3">{head}</div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </section>
  );
}

/**
 * The rail: its `head` (the tabs) stays, its panel scrolls with the card's
 * padding, and the `dock` (the docked chat) keeps up to half the rail at its
 * foot under a hairline. Without a panel the dock fills the rail.
 */
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
            panel ? 'border-line max-h-[50%] shrink-0 border-t' : 'flex-1',
          )}
        >
          {dock}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A docked conversation: the thread scrolls in its own region (`scrollRef`,
 * named by `label`) and the composer stays under it.
 */
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
