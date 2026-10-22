import { cn } from '@/lib/utils';

/**
 * Card is a semantic object, not a structural layout container.
 *
 * One box recipe (docs/design.md §Component recipes): radius 12, a one-pixel
 * `border` and 16 padding on the box element itself, shared with `Panel`.
 * Tones change the fill and the edge colour, never the geometry, and there is
 * no padding or radius variant: content that owns its edges (a table, a
 * scrolling list) sits inside the same 16 inset as everything else.
 *
 * The card deliberately sets no display of its own. Making it a flex column
 * would be convenient for pinning a `CardFooter`, but it would also re-flow
 * every card in the app and put an `overflow` boundary between a sticky child
 * and its scroll container. `CardGrid` opts a row into that column layout
 * instead, so only the cards that need aligned footers get it.
 */
const CARD_BOX =
  'surface-card bg-panel rounded-[var(--radius-card)] border border-border p-[var(--card-padding)]';

export type CardTone = 'default' | 'danger' | 'recommendation';

const CARD_TONE = {
  default: '',
  danger: 'border-danger-border',
  // The wash alone marks the recommendation; a bright green outline on top
  // of it shouted louder than the action inside.
  recommendation: 'surface-card-recommendation bg-accent-soft',
} as const satisfies Record<CardTone, string>;

export const cardClasses = (tone: CardTone = 'default') => cn(CARD_BOX, CARD_TONE[tone]);
