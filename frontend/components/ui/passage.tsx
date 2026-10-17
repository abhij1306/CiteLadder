import type { ReactNode } from 'react';

import { panelClasses } from '@/components/ui/panel';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

/**
 * Passage — a quoted line lifted verbatim from a page we do not own.
 *
 * This is the product's core evidence claim: the reason a reader should
 * believe a competitor is on a page is that the page says so, in these words.
 * It was being rebuilt by hand at every site that makes such a claim, which is
 * how the same element already renders two different ways across the app.
 *
 * A `blockquote`, not a `div`: the text is somebody else's and the markup
 * should say so.
 */
export function Passage({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <blockquote className={panelClasses({ tone: 'well', pad: 'compact' }, className)}>
      <p className={textRole('body')}>“{children}”</p>
    </blockquote>
  );
}

/**
 * Limitations — what a reader may NOT conclude from what they are looking at.
 *
 * One home, because the rule these carry is one rule: a finding is shown with
 * its caveats or it is not shown honestly. Five surfaces were each rendering
 * the same muted list by hand.
 */
export function Limitations({
  items,
  className,
}: Readonly<{ items: readonly string[]; className?: string }>) {
  if (!items.length) return null;
  return (
    <div className={cn('grid gap-1', className)}>
      {items.map((item) => (
        <p key={item} className="type-caption">
          {item}
        </p>
      ))}
    </div>
  );
}
