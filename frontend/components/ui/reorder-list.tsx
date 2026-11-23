import { useState, type KeyboardEvent, type ReactNode } from 'react';

import { IconButton } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { SLIP_FACE } from '@/components/ui/slip';
import { textRole } from '@/components/ui/typography';
import { Ellipsis, GripVertical } from '@/lib/icons';
import { cn } from '@/lib/utils';

const ROW_DRAG_TYPE = 'application/x-citeladder-reorder-row';

const KEY_STEP = new Map([
  ['ArrowUp', -1],
  ['ArrowDown', 1],
]);

export type ReorderItem = Readonly<{
  key: string;
  name: string;
  content: ReactNode;
}>;

export function ReorderList({
  items,
  pending,
  onMove,
}: Readonly<{
  items: readonly ReorderItem[];
  pending: boolean;
  onMove: (from: number, to: number) => void;
}>) {
  const moveDropped = (dropped: string, to: number) => {
    const from = Number(dropped);
    if (dropped !== '' && Number.isInteger(from) && from >= 0 && from < items.length && from !== to)
      onMove(from, to);
  };
  return (
    <ol className={cn(SLIP_FACE, 'divide-rule m-0 list-none divide-y overflow-hidden p-0')}>
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
  const up = { label: `Move ${index + 1}, ${item.name}, up`, disabled: pending || index === 0 };
  const down = { label: `Move ${index + 1}, ${item.name}, down`, disabled: pending || last };
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.altKey ? KEY_STEP.get(event.key) : undefined;
    if (!step || (step < 0 ? up : down).disabled) return;
    event.preventDefault();
    onMove(index, index + step);
  };
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <li // NOSONAR
      draggable={!pending}
      onKeyDown={onKeyDown}
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
        'group hover:overlay-hover grid min-h-10 grid-cols-[1rem_1.25rem_minmax(0,1fr)_auto] items-center gap-2 ps-2 pe-2 transition-colors',
        dragging && 'opacity-60',
      )}
    >
      <Icon
        icon={GripVertical}
        className="text-ink-2 cursor-grab opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
      />
      <span className={textRole('body', 'text-ink-2 text-center tabular-nums')}>{index + 1}</span>
      <div className="min-w-0">{item.content}</div>
      <Menu>
        <MenuTrigger asChild>
          <IconButton icon={Ellipsis} label={`Reorder ${index + 1}, ${item.name}`} />
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem
            shortcut="Alt ↑"
            aria-label={up.label}
            disabled={up.disabled}
            onSelect={() => onMove(index, index - 1)}
          >
            Move up
          </MenuItem>
          <MenuItem
            shortcut="Alt ↓"
            aria-label={down.label}
            disabled={down.disabled}
            onSelect={() => onMove(index, index + 1)}
          >
            Move down
          </MenuItem>
        </MenuContent>
      </Menu>
    </li>
  );
}
