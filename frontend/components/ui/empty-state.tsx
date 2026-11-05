import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

const HEADING_TAG = { 1: 'h1', 2: 'h2', 3: 'h3' } as const;

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
  variant?: 'block' | 'inline';
  /** The block title's heading level; a route boundary that owns the page heading uses 1. */
  headingLevel?: 1 | 2 | 3;
}>) {
  if (variant === 'inline') {
    return (
      <div
        data-empty-state="inline"
        className="bg-surface-sunken flex min-w-0 items-center gap-3 rounded-md px-4 py-3"
      >
        {Icon ? (
          <span className="text-ink-secondary inline-flex h-5 shrink-0 items-center self-start">
            <Icon className="size-4" aria-hidden />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-label text-ink">{title}</p>
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
          className="bg-surface text-ink-secondary mb-4 grid size-10 place-items-center rounded-md shadow-xs"
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
