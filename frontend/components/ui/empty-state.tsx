import { createContext, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

const HEADING_TAG = { 1: 'h1', 2: 'h2', 3: 'h3' } as const;

type HeadingLevel = keyof typeof HEADING_TAG;

/**
 * The heading level a block empty state (`QueryState` `kind="empty"`) takes
 * when its caller names none: 2 on a page, 3 inside a Card or a DataTable,
 * whose own title is the h3 rung. An explicit `headingLevel` always wins.
 */
export const EmptyHeadingLevelContext = createContext<HeadingLevel>(2);

/**
 * EmptyState — what a card, list or page shows when it has nothing yet: an
 * icon, a title, one sentence saying why and when it fills, and the next step.
 *
 *   `block` (default) — centred, `container-narrow` wide, 48px above and
 *     below; the 20px icon on a 40px `surface` tile with the xs ring; title
 *     16/24 semibold; buttons 24px below, primary first.
 *   `inline` — one `surface-sunken` row (`radius-md`, 12/16px padding) inside
 *     a card or list: the 16px icon, title and sentence, the action at the
 *     right edge.
 *   `compact` — one line on the container's own surface, no box: the 16px
 *     icon, the title in `ink-secondary` (cut to one line) and the action at
 *     the right edge, within one table row. For a small card or a table of a
 *     few columns, where even the inline row is more than the content.
 *
 * Never shown while loading (that is a Skeleton); at most two actions.
 */
export function EmptyState({
  title,
  description,
  icon: Icon,
  primary,
  secondary,
  variant = 'block',
  headingLevel = 3,
}: Readonly<{
  title: ReactNode;
  /** One sentence. */
  description?: ReactNode;
  icon?: LucideIcon;
  /** A primary Button. */
  primary?: ReactNode;
  /** A secondary Button or a TextLink. */
  secondary?: ReactNode;
  variant?: 'block' | 'inline' | 'compact';
  /** The block title's heading level; a route boundary that owns the page heading uses 1. */
  headingLevel?: HeadingLevel;
}>) {
  if (variant === 'compact') {
    return <CompactEmptyState title={title} icon={Icon} primary={primary} secondary={secondary} />;
  }
  if (variant === 'inline') {
    return (
      <div
        data-empty-state="inline"
        className="surface-inset flex min-w-0 items-center gap-3 rounded-md border px-4 py-3"
      >
        {Icon ? (
          <span className="text-ink-secondary inline-flex h-5 shrink-0 items-center self-start">
            <Icon className="size-4" aria-hidden />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-body-sm text-ink">{title}</p>
          {description ? <p className="text-body-sm text-ink-secondary">{description}</p> : null}
        </div>
        {primary || secondary ? (
          <div className="flex shrink-0 items-center gap-2">
            {secondary}
            {primary}
          </div>
        ) : null}
      </div>
    );
  }
  const Heading = HEADING_TAG[headingLevel];
  return (
    <div
      data-empty-state="block"
      className="max-w-narrow mx-auto flex flex-col items-center px-[var(--card-padding)] py-12 text-center"
    >
      {Icon ? (
        <span
          aria-hidden
          className="bg-surface border-line text-ink-secondary mb-4 grid size-10 place-items-center rounded-md border"
        >
          <Icon className="size-5" />
        </span>
      ) : null}
      <div className="flex max-w-100 flex-col gap-1">
        <Heading className="text-heading text-ink">{title}</Heading>
        {description ? <p className="text-body-sm text-ink-secondary">{description}</p> : null}
      </div>
      {primary || secondary ? (
        <div className={cn('mt-6 flex items-center gap-2')}>
          {primary}
          {secondary}
        </div>
      ) : null}
    </div>
  );
}

/** The one-line empty state: no box, no description, the row's height at most. */
function CompactEmptyState({
  title,
  icon: Icon,
  primary,
  secondary,
}: Readonly<{
  title: ReactNode;
  icon?: LucideIcon;
  primary?: ReactNode;
  secondary?: ReactNode;
}>) {
  return (
    <div
      data-empty-state="compact"
      className="text-body-sm text-ink-secondary flex min-w-0 items-center gap-2"
    >
      {Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
      <p className="min-w-0 flex-1 truncate">{title}</p>
      {primary || secondary ? (
        <div className="flex shrink-0 items-center gap-2">
          {secondary}
          {primary}
        </div>
      ) : null}
    </div>
  );
}
