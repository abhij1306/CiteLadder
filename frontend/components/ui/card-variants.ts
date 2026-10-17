import { cva } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Card is a semantic object, not a structural layout container.
 *
 * A fine inset edge and layered elevation lift objects from workspace ground.
 * Dark surfaces use inset highlights. Status tones retain their explicit edge.
 *
 * The card deliberately sets no display of its own. Making it a flex column
 * would be convenient for pinning a `CardFooter`, but it would also re-flow
 * every card in the app and put an `overflow` boundary between a sticky child
 * and its scroll container. `CardGrid` opts a row into that column layout
 * instead, so only the cards that need aligned footers get it.
 */
const cardVariants = cva('surface-card bg-panel rounded-[var(--radius-card)]');

export type CardTone = 'default' | 'danger' | 'recommendation';

export const cardClasses = (tone: CardTone = 'default') =>
  cn(
    cardVariants({}),
    tone === 'danger' && 'border border-danger-border',
    // The wash alone marks the recommendation; a bright green outline on top
    // of it shouted louder than the action inside.
    tone === 'recommendation' && 'surface-card-recommendation bg-accent-soft',
  );
