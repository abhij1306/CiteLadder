'use client';

import type { FormEvent, ReactNode } from 'react';

import { listRowClasses } from '@/components/ui/list-row';
import { Pressable } from '@/components/ui/pressable';
import { Tooltip } from '@/components/ui/tooltip';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

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
          <span className="type-caption shrink-0 tabular-nums">{count}</span>
        ) : null}
      </Pressable>
      {actions}
    </div>
  );
}

/**
 * An item's name edited in place: the field and its submit on one row, at the
 * item's own indent so the edit stays where the name was.
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
