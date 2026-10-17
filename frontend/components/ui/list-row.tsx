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
