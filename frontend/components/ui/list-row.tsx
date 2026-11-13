import { Check } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Spinner } from '@/components/ui/spinner';
import { ClampText } from '@/components/ui/table';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

/**
 * The one selected-row treatment for a selectable list beside its detail
 * (catalog tree, issue list).
 *
 * Selected takes the shared selected tint and the foreground ink, the same
 * filled face as a selected tab, segment or navigation row (owner,
 * 2026-11-04: active states are buttons, not marks). Unselected rows take the
 * neutral hover and pressed tints. The state itself must also be in the markup — the caller
 * sets `aria-current` (navigation-like lists), `aria-selected` (a
 * listbox/grid option) or `aria-pressed` (a toggle); colour is never the only
 * signal.
 *
 * Layout (padding, gap, grid) stays with the caller: rows differ in anatomy,
 * not in state.
 */
function listRowClasses({ selected = false }: Readonly<{ selected?: boolean }> = {}) {
  return cn(
    'relative rounded-md transition-[background-color,color] duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
    // Three states, three overlays (D51): selected never looks hovered.
    selected
      ? 'overlay-selected text-ink'
      : 'text-ink-secondary hover:overlay-hover hover:text-ink active:overlay-pressed',
  );
}

/** A padded row's own geometry: 12 across, 8 down, its parts 12 apart. */
const paddedRowClasses = 'focus-ring flex w-full items-center gap-3 px-3 py-2 text-start';

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
        'disabled:pointer-events-none disabled:[&_.type-item-title]:text-ink-muted',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className={textRole('itemTitle', 'block truncate')}>{title}</span>
        {caption ? (
          <span className="type-caption block truncate tabular-nums">{caption}</span>
        ) : null}
      </span>
      {pending ? <Spinner className="text-ink-muted" /> : null}
      {selected && !pending ? <Icon icon={Check} className="text-accent" /> : null}
    </Pressable>
  );
}

/**
 * A ledger list's row that opens its item (an issue's detail): an optional
 * leading number, the title, the item's meta at the end of the same wrapping
 * line, and an optional caption under it. The row owns its padding (8 across,
 * 4 down), its gaps and the hover state; the caller passes the content.
 */
export function OpenRow({
  number,
  title,
  meta,
  caption,
  onOpen,
}: Readonly<{
  number?: number;
  title: ReactNode;
  meta?: ReactNode;
  caption?: ReactNode;
  onOpen: () => void;
}>) {
  return (
    <Pressable
      onClick={onOpen}
      className={cn(listRowClasses(), 'focus-ring grid min-w-0 gap-1 px-2 py-1 text-start')}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        {number === undefined ? null : (
          <span className="type-caption w-6 shrink-0 tabular-nums">{number}</span>
        )}
        <span className={textRole('itemTitle', 'min-w-0 flex-1')}>{title}</span>
        {meta}
      </span>
      {caption ? <span className="type-caption">{caption}</span> : null}
    </Pressable>
  );
}

/** A tree list: its `TreeItem`s and `TreeItemForm`s, 2 apart. */
export function TreeList({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <ul aria-label={label} className="flex min-w-0 flex-col gap-0.5">
      {children}
    </ul>
  );
}

/**
 * A tree list's row (topics and their subtopics, in the dialog that manages
 * them): one control tall — the label, truncated with the whole name behind
 * a tooltip, an optional count, and icon actions (`IconButton`s) at the
 * row's end. A nested item (one level deep) is indented 12 from its parent.
 * The row owns the height, the indent and the gaps; the page passes names,
 * counts and actions.
 */
export function TreeItem({
  label,
  count,
  nested = false,
  actions,
}: Readonly<{
  label: string;
  count?: number;
  nested?: boolean;
  actions?: ReactNode;
}>) {
  return (
    <li
      data-tree-item=""
      className={cn(
        'text-ink flex min-h-[var(--nav-item-height)] min-w-0 items-center gap-2 ps-3 pe-0.5',
        nested && 'ms-3',
        listRowClasses(),
      )}
    >
      <ClampText lines={1} className="type-control flex-1">
        {label}
      </ClampText>
      {typeof count === 'number' ? (
        <span className="type-caption shrink-0 font-mono">{count}</span>
      ) : null}
      {actions}
    </li>
  );
}

/** A tree option's indent per depth, 16 a level (category paths stop at six levels). */
const TREE_INDENT = ['', 'ms-4', 'ms-8', 'ms-12', 'ms-16', 'ms-20'] as const;
const treeIndent = (depth: number) => TREE_INDENT[Math.min(depth, TREE_INDENT.length - 1)];

/**
 * A tree list's row that is a box to tick (a proposed category to keep):
 * the checkbox and its label, an optional badge after it, indented 16 a
 * level of `depth`.
 */
export function TreeCheckOption({
  label,
  checked,
  disabled = false,
  depth = 0,
  badge,
  onCheckedChange,
}: Readonly<{
  label: string;
  checked: boolean;
  disabled?: boolean;
  depth?: number;
  badge?: ReactNode;
  onCheckedChange: (checked: boolean) => void;
}>) {
  return (
    <li
      className={cn(
        'flex min-h-[var(--nav-item-height)] min-w-0 items-center gap-2',
        treeIndent(depth),
      )}
    >
      <Checkbox
        label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next === true)}
      />
      {badge}
    </li>
  );
}

/**
 * A tree list's row that is itself the choice (a category narrowing a table):
 * one control tall, the label truncated and its count at the end, pressed to
 * select, marked `aria-current` while selected. Each level of `depth` is
 * indented 16 from its parent.
 */
export function TreeOption({
  label,
  count,
  selected,
  depth = 0,
  onSelect,
}: Readonly<{
  label: string;
  count?: string;
  selected: boolean;
  depth?: number;
  onSelect: () => void;
}>) {
  return (
    <li className={cn('min-w-0', treeIndent(depth))}>
      <Pressable
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          listRowClasses({ selected }),
          'focus-ring flex min-h-[var(--nav-item-height)] w-full min-w-0 items-center gap-2 ps-3 pe-2 text-start',
        )}
      >
        <ClampText lines={1} className="type-control flex-1">
          {label}
        </ClampText>
        {count === undefined ? null : (
          <span className="type-caption shrink-0 tabular-nums">{count}</span>
        )}
      </Pressable>
    </li>
  );
}

/**
 * A tree item's name edited in place: the field and its submit on one row,
 * at the item's own indent so the edit stays where the name was.
 */
export function TreeItemForm({
  nested = false,
  onSubmit,
  children,
}: Readonly<{ nested?: boolean; onSubmit: () => void; children: ReactNode }>) {
  return (
    <li>
      <form
        className={cn('flex items-center gap-2', nested && 'ms-3')}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {children}
      </form>
    </li>
  );
}
