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
 */
const PANEL_TONE = {
  /** Raised out of the section — the default for a nested object. */
  panel: 'bg-panel',
  /** Recessed — evidence, payloads, quoted source. */
  well: 'bg-well',
  /** Quietly separated, for a row that is chrome rather than content. */
  tonal: 'bg-background-alt',
  /** Advice: a suggested next step or a quoted prompt. */
  accent: 'bg-accent-soft',
  /** The caller supplies the fill because it carries a status meaning. */
  none: '',
} as const;

const PANEL_PAD = {
  none: '',
  compact: 'p-[var(--card-padding)]',
  default: 'p-[var(--card-padding)]',
  large: 'p-[var(--card-padding)]',
} as const;

/**
 * Panels normally carry their own radius. `flush` is for a panel TILED inside
 * another surface — a strip of cards filling a card — where the container
 * already draws the outer edge and a per-tile radius would show as notches
 * along the seams.
 *
 * A box is separated by a fill OR an edge, never both. Only the white `panel`
 * tone draws an edge, because it is white inside a white card and has nothing
 * else; a tinted panel's fill is its boundary, and an outline around it is one
 * more line on the screen carrying no information.
 */
const PANEL_EDGE = {
  rounded: 'rounded-[var(--radius-card)]',
  flush: '',
} as const;

export type PanelEdge = keyof typeof PANEL_EDGE;
export type PanelTone = keyof typeof PANEL_TONE;
export type PanelPad = keyof typeof PANEL_PAD;

export function panelClasses(
  {
    tone = 'panel',
    pad = 'default',
    edge = 'rounded',
  }: { tone?: PanelTone; pad?: PanelPad; edge?: PanelEdge } = {},
  className?: string,
) {
  return cn(
    // Marks a container surface: a nested empty state shares it rather than
    // drawing a second card inside.
    'surface-panel',
    PANEL_EDGE[edge],
    tone === 'panel' && edge === 'rounded' && 'border-border border',
    PANEL_TONE[tone],
    PANEL_PAD[pad],
    className,
  );
}
