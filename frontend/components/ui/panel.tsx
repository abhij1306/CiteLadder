import { cn } from '@/lib/utils';

/**
 * Panel — the bordered, filled box that sits *inside* a Card or a section.
 *
 * Twenty-seven places used to build this by hand, each picking its own fill,
 * border colour, radius and padding, which is why the same evidence box looked
 * different in six screens. `Card` could not absorb them: a Card may not nest
 * inside a Card, and most of these are structure rather than semantic objects.
 *
 * This is a class recipe, not a component, because these boxes land on `div`,
 * `li`, `section` and `dd` alike and the element must stay semantic.
 *
 * One box recipe (docs/design.md §Component recipes), shared with `Card`:
 * radius 12, a one-pixel `border` and 16 padding. The tone picks the fill and
 * the edge colour only; there is no padding, radius or edge variant.
 */
const PANEL_TONE = {
  /** Raised out of the section — the default for a nested object. */
  panel: 'bg-panel border-border',
  /** Recessed — evidence, payloads, quoted source. */
  well: 'bg-well border-transparent',
  /** A row inside a card that is chrome rather than content: its edge only,
   *  because a fill inside a card would be a fourth surface level. */
  tonal: 'border-border',
  /** The caller supplies the fill because it carries a status meaning. */
  none: 'border-transparent',
} as const;

/*
 * A box is separated by a fill OR an edge, never both. The `panel` and `tonal`
 * tones show their edge; the recessed `well` is the one inset fill a card may
 * hold (owner, 2026-11-03: at most three surface levels), so its border is
 * transparent and keeps the same one-pixel geometry.
 */
export type PanelTone = keyof typeof PANEL_TONE;

export function panelClasses({ tone = 'panel' }: { tone?: PanelTone } = {}, className?: string) {
  return cn(
    // Marks a container surface: a nested empty state shares it rather than
    // drawing a second card inside.
    'surface-panel rounded-[var(--radius-card)] border p-[var(--card-padding)]',
    PANEL_TONE[tone],
    className,
  );
}
