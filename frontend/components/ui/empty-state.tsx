import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { cardClasses } from '@/components/ui/card-variants';
import { textRole } from '@/components/ui/typography';

/**
 * EmptyState — the one empty-state pattern for the whole app.
 *
 * Replaces the per-surface empty states that had each grown their own copy and
 * layout. Shape: a small icon beside the heading → one short line → one action,
 * hung on the section's left margin. On the sheet it is its own card surface
 * (`.empty-state-surface`), so a "connect to start" prompt never reads as bare
 * text beside the page's other cards; inside a card, dialog or table it drops
 * that surface and shares the container's. Never wrap it in a Card yourself —
 * that is what doubled the padding.
 *
 * **Keep `description` to a single sentence.** The empty states this replaces
 * had drifted into two- and three-clause explanations of what the screen would
 * eventually contain, which is what made them feel crowded. Say what is missing
 * and what to do about it; the screen itself explains the rest once it has
 * data. The prop is optional precisely so surfaces can omit it when the
 * heading already says everything.
 *
 * `action` is a single primary control. Pass a second one only when both are
 * genuinely equal choices — otherwise the secondary path belongs in the body of
 * the screen, not in its empty state.
 */
/** A route boundary owns the page heading; everything else nests under one. */
const HEADING_TAG: Record<1 | 2 | 3, 'h1' | 'h2' | 'h3'> = { 1: 'h1', 2: 'h2', 3: 'h3' };

export function EmptyState({
  icon: Icon,
  heading,
  description,
  action,
  footnote,
  className,
  headingLevel = 2,
  variant = 'page',
}: Readonly<{
  icon: LucideIcon;
  heading: string;
  /** One sentence. See the note above before making it two. */
  description?: string;
  action?: ReactNode;
  /** Small muted line below the action (e.g. a support correlation reference). */
  footnote?: ReactNode;
  className?: string;
  /** Route boundaries use their one truthful screen heading. */
  headingLevel?: 1 | 2 | 3;
  /** Compact states belong inside an otherwise useful section. */
  variant?: 'page' | 'compact';
}>) {
  const Heading = HEADING_TAG[headingLevel];
  let headingRole: Parameters<typeof textRole>[0] = 'sectionTitle';
  if (headingLevel === 1) headingRole = 'pageTitle';
  if (variant === 'compact') headingRole = 'itemTitle';
  return (
    <div
      data-empty-state={variant}
      className={cn(
        cardClasses(),
        'empty-state-surface grid gap-3',
        variant === 'compact' && 'desktop:gap-1',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className="text-muted size-4 shrink-0" aria-hidden />
        <Heading className={textRole(headingRole)}>{heading}</Heading>
      </div>
      {description ? (
        <p className={cn('type-body max-w-[52ch]', variant === 'compact' && 'desktop:pl-6')}>
          {description}
        </p>
      ) : null}
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
      {footnote ? <div className="type-caption">{footnote}</div> : null}
    </div>
  );
}
