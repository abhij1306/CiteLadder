'use client';

import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { IconButton } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses } from '@/components/ui/workspace';
import { cn } from '@/lib/utils';

/** The drag type a row's position travels under; no other source sets it. */
const ROW_DRAG_TYPE = 'application/x-citeladder-reorder-row';

export type ReorderItem = Readonly<{
  key: string;
  /** Names the item in its move controls ("Move <name> up"). */
  name: string;
  content: ReactNode;
  /** A figure beside the move controls (a priority score). */
  figure?: ReactNode;
}>;

/**
 * A shared, ranked list the reader can reorder: each row is its position, its
 * content, an optional figure, and move-up/move-down controls. Dragging a row
 * onto another is a progressive enhancement; the buttons are the complete
 * keyboard path. Rows are divided like a ledger and padded 12; below
 * `desktop` the position, content and controls stack.
 */
export function ReorderList({
  items,
  pending,
  onMove,
}: Readonly<{
  items: readonly ReorderItem[];
  /** A move is being saved: dragging and the controls wait for it. */
  pending: boolean;
  onMove: (from: number, to: number) => void;
}>) {
  // A drop carries the dragged row's position under the list's own drag type;
  // anything else dropped on the list (selected text, a row's visible number,
  // a link from another page) carries none and is not a move.
  const moveDropped = (dropped: string, to: number) => {
    const from = Number(dropped);
    if (dropped !== '' && Number.isInteger(from) && from >= 0 && from < items.length && from !== to)
      onMove(from, to);
  };
  return (
    <ol className={ledgerClasses('open')}>
      {items.map((item, index) => (
        <ReorderRow
          key={item.key}
          item={item}
          index={index}
          last={index === items.length - 1}
          pending={pending}
          onMove={onMove}
          onDropped={(dropped) => moveDropped(dropped, index)}
        />
      ))}
    </ol>
  );
}

function ReorderRow({
  item,
  index,
  last,
  pending,
  onMove,
  onDropped,
}: Readonly<{
  item: ReorderItem;
  index: number;
  last: boolean;
  pending: boolean;
  onMove: (from: number, to: number) => void;
  onDropped: (dropped: string) => void;
}>) {
  const [dragging, setDragging] = useState(false);
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Pointer drag is progressive enhancement; adjacent buttons provide the complete keyboard reorder path.
    <li
      draggable={!pending}
      onDragStart={(event) => {
        event.dataTransfer.setData(ROW_DRAG_TYPE, String(index));
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (!pending) onDropped(event.dataTransfer.getData(ROW_DRAG_TYPE));
      }}
      className={cn(
        'hover:bg-hover active:bg-active desktop:grid-cols-[auto_minmax(0,1fr)_auto] desktop:items-center grid gap-3 py-3 transition-colors',
        dragging && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-2">
        <Icon icon={GripVertical} className="text-muted hover:text-foreground cursor-grab" />
        <span className={textRole('label', 'font-numeric w-5 text-center')}>{index + 1}</span>
      </div>
      <div className="min-w-0">{item.content}</div>
      <div className="flex items-center justify-end gap-2">
        {item.figure}
        <IconButton
          icon={ArrowUp}
          label={`Move ${item.name} up`}
          onClick={() => onMove(index, index - 1)}
          disabled={pending || index === 0}
        />
        <IconButton
          icon={ArrowDown}
          label={`Move ${item.name} down`}
          onClick={() => onMove(index, index + 1)}
          disabled={pending || last}
        />
      </div>
    </li>
  );
}
