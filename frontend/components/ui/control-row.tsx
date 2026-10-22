import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { panelClasses } from '@/components/ui/panel';
import { cn } from '@/lib/utils';

/**
 * A row that offers something and the controls that act on it: an optional
 * leading mark (an `IconTile`), the text column, and the controls at the end.
 * Below `desktop` the controls drop under the text, aligned to the row's end,
 * so a long name never squeezes its buttons. The text column's anatomy (a
 * `Stack` of title and captions) is the caller's; the alignment, the gaps and
 * the stacking are the row's.
 *
 *   `boxed` — a standalone offer on the section's surface (a plan, an add-on,
 *             a plan change): the tonal panel, padding 16.
 *   unboxed — a row inside a card that already frames it (a connection).
 */
export function ControlRow({
  media,
  children,
  controls,
  boxed = false,
  ...props
}: Readonly<
  Omit<ComponentPropsWithoutRef<'div'>, 'className' | 'children'> & {
    media?: ReactNode;
    children: ReactNode;
    controls: ReactNode;
    boxed?: boolean;
  }
>) {
  return (
    <div
      {...props}
      data-control-row=""
      className={cn(
        'desktop:flex-row desktop:items-center flex flex-col justify-between gap-[var(--compact-gap)]',
        boxed && panelClasses({ tone: 'tonal' }),
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-[var(--compact-gap)]">
        {media}
        <div className="grid min-w-0 flex-1 gap-1">{children}</div>
      </div>
      <div className="desktop:self-auto flex shrink-0 flex-wrap items-center gap-2 self-end">
        {controls}
      </div>
    </div>
  );
}
