'use client';

import type { ReactNode } from 'react';

import { BusyBar } from '@/components/ui/busy-bar';
import { Card } from '@/components/ui/card';
import { listRowClasses } from '@/components/ui/list-row';
import { Pressable } from '@/components/ui/pressable';
import { splitPaneClasses } from '@/components/ui/workspace';
import { cn } from '@/lib/utils';

/**
 * The selectable-list-beside-its-detail organism, in one card: a divided
 * column of pressable rows, and the selected item's pane, which stays in view
 * while the list scrolls. The card owns the split (`list-detail`), the rows'
 * padding and rhythm, and the pane's header band, scrolling body and footer;
 * the page passes the rows' content and the pane's content only.
 */
export function ListDetailCard({
  list,
  detail,
  busy = false,
}: Readonly<{ list: ReactNode; detail: ReactNode; busy?: boolean }>) {
  return (
    <Card
      // `overflow-clip` (not `hidden`) rounds the corners without becoming a
      // scroll container, so the detail pane stays sticky against the page.
      className={splitPaneClasses('list-detail', 'gap-0 overflow-clip')}
      aria-busy={busy}
    >
      {/* One vertical list at every width: above the detail when the panes
          stack, beside it on desktop. */}
      <div className="border-border-subtle divide-border-subtle desktop:border-r desktop:border-b-0 grid min-w-0 divide-y border-b">
        {list}
      </div>
      {detail}
    </Card>
  );
}

/** One row of the list: a pressed toggle for the item it selects. */
export function ListDetailRow({
  selected,
  onSelect,
  children,
}: Readonly<{ selected: boolean; onSelect: () => void; children: ReactNode }>) {
  return (
    <Pressable
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'focus-ring grid w-full gap-2 px-4 py-3 text-left',
        listRowClasses({ selected }),
      )}
    >
      {children}
    </Pressable>
  );
}

/**
 * The selected item's pane: a header band closed by a hairline (title,
 * facts, actions), a body that scrolls inside the pane on desktop, and an
 * optional footer (a pager) pinned under it.
 */
export function ListDetailPane({
  header,
  children,
  footer,
  busy,
}: Readonly<{
  header: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** A background refetch of the pane's content. */
  busy?: Readonly<{ active: boolean; label: string }>;
}>) {
  return (
    <section
      className="desktop:sticky desktop:top-[var(--workspace-gap)] desktop:max-h-[calc(100dvh-2*var(--workspace-gap))] desktop:overflow-hidden min-w-0"
      aria-busy={busy?.active}
    >
      <div className="desktop:max-h-[calc(100dvh-2*var(--workspace-gap))] relative flex flex-col">
        {busy ? <BusyBar active={busy.active} label={busy.label} /> : null}
        <header className="border-border-subtle grid min-w-0 shrink-0 gap-[var(--compact-gap)] border-b p-[var(--card-padding)]">
          {header}
        </header>
        <div className="content-scroll desktop:flex-1 desktop:overflow-y-auto grid min-h-0 gap-[var(--workspace-gap)] p-[var(--card-padding)]">
          {children}
        </div>
        {footer ? <div className="bg-panel shrink-0">{footer}</div> : null}
      </div>
    </section>
  );
}
