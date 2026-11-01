'use client';

import { Check, ChevronRight } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';

import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip } from '@/components/ui/tooltip';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

/**
 * The one selected-row treatment for a selectable list beside its detail
 * (catalog tree, issue list, pressable stats).
 *
 * Selected is the neutral tint the sidebar's current location uses: the
 * receiving surface's selected state and primary ink, so a selected row reads
 * as part of its list rather than as a card lifted off it. Unselected rows
 * take the neutral hover and pressed tints. The state itself must also be in the markup — the caller
 * sets `aria-current` (navigation-like lists), `aria-selected` (a
 * listbox/grid option) or `aria-pressed` (a toggle); colour is never the only
 * signal.
 *
 * Layout (padding, gap, grid) stays with the caller: rows differ in anatomy,
 * not in state.
 */
export function listRowClasses({ selected = false }: Readonly<{ selected?: boolean }> = {}) {
  return cn(
    'rounded-[var(--radius-control)] transition-[background-color,color] duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
    selected
      ? 'bg-selected text-foreground'
      : 'text-secondary hover:bg-hover hover:text-foreground active:bg-active',
  );
}

/** A padded row's own geometry: 12 across, 8 down, its parts 12 apart. */
const paddedRowClasses = 'focus-ring flex w-full items-center gap-3 px-3 py-2 text-start';

/**
 * NavRow — a row that takes you somewhere (a workspace to enter): the
 * caller's text column, an optional trailing mark (a status badge) and the
 * chevron that says the row navigates. It owns the padded row's geometry and
 * the neutral row tints, like `OptionRow`.
 */
export function NavRow({
  children,
  trailing,
  onSelect,
}: Readonly<{ children: ReactNode; trailing?: ReactNode; onSelect: () => void }>) {
  return (
    <Pressable type="button" onClick={onSelect} className={cn(listRowClasses(), paddedRowClasses)}>
      <span className="grid min-w-0 flex-1">{children}</span>
      {trailing}
      <Icon icon={ChevronRight} />
    </Pressable>
  );
}

/**
 * One choice in a list where pressing the row IS the commit (a property to
 * import, an account to use): a title, one caption line, and at the end a
 * spinner while the choice is being applied or the check once it is. The row
 * owns its padding (12 across, 8 down) and the pressed state.
 */
export function OptionRow({
  title,
  caption,
  selected,
  pending = false,
  disabled,
  onSelect,
}: Readonly<{
  title: ReactNode;
  caption?: ReactNode;
  selected: boolean;
  pending?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}>) {
  return (
    <Pressable
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        listRowClasses({ selected }),
        paddedRowClasses,
        'disabled:pointer-events-none disabled:[&_.type-item-title]:text-muted',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className={textRole('itemTitle', 'block truncate')}>{title}</span>
        {caption ? (
          <span className="type-caption block truncate tabular-nums">{caption}</span>
        ) : null}
      </span>
      {pending ? <Spinner className="text-muted" /> : null}
      {selected && !pending ? <Icon icon={Check} className="text-accent" /> : null}
    </Pressable>
  );
}

/**
 * A tree rail: the selectable list beside a library that filters it (topics
 * and their subtopics). Each item is a 32px navigation row — the label,
 * truncated with the whole name behind a tooltip, an optional count, and
 * icon actions (`IconButton`s) at the row's end. A nested item (one level
 * deep) is indented 12 from its parent. The rail owns the row height, the
 * indent and the gaps; the page passes names, counts and actions.
 */
export function RailItem({
  label,
  accessibleName,
  count,
  selected,
  nested = false,
  onSelect,
  actions,
}: Readonly<{
  label: string;
  /** A fuller name for assistive technology (a subtopic names its parent). */
  accessibleName?: string;
  count?: number;
  selected: boolean;
  nested?: boolean;
  onSelect: () => void;
  actions?: ReactNode;
}>) {
  return (
    <div
      className={cn(
        'group flex min-w-0 items-center gap-0.5 pe-0.5',
        nested && 'ms-3',
        listRowClasses({ selected }),
      )}
    >
      <Pressable
        type="button"
        data-rail-item=""
        onClick={onSelect}
        aria-label={accessibleName}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'focus-ring flex h-[var(--nav-item-height)] min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-control)] px-3 text-left type-control',
          selected && textRole('emphasis'),
        )}
      >
        <Tooltip content={label}>
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </Tooltip>
        {typeof count === 'number' ? (
          <span className="type-caption font-numeric shrink-0">{count}</span>
        ) : null}
      </Pressable>
      {actions}
    </div>
  );
}

/**
 * A rail item's name edited in place: the field and its submit on one row,
 * at the item's own indent so the edit stays where the name was.
 */
export function RailItemForm({
  nested = false,
  onSubmit,
  children,
}: Readonly<{ nested?: boolean; onSubmit: () => void; children: ReactNode }>) {
  return (
    <form
      className={cn('flex items-center gap-2', nested && 'ms-3')}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}
