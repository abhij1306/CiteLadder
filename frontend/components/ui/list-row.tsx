import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Spinner } from '@/components/ui/spinner';
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
        'focus-ring flex w-full items-center gap-3 px-3 py-2 text-start',
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
