'use client';

import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

import { Pressable } from '@/components/ui/pressable';
import { textRole } from '@/components/ui/typography';

/**
 * Where in Sources the reader is, and the way back out.
 *
 * A real `<nav>` with a list, not a row of styled buttons: the trail is how
 * someone using a screen reader learns there is a level above this one, and a
 * back arrow alone never says what it goes back TO.
 *
 * The last crumb is the current page and is not a control. Making it one would
 * offer a reader a link to where they already are.
 */
export function SourceBreadcrumb({
  trail,
  current,
  actions,
}: Readonly<{
  trail: readonly { label: string; onClick: () => void }[];
  current: string;
  actions?: ReactNode;
}>) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <nav aria-label="Sources breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 flex-wrap items-center gap-1">
          {trail.map((crumb) => (
            <li key={crumb.label} className="flex items-center gap-1">
              <Pressable
                onClick={crumb.onClick}
                className={textRole(
                  'caption',
                  'text-secondary hover:text-accent-text w-auto transition-colors',
                )}
              >
                {crumb.label}
              </Pressable>
              <ChevronRight className="text-muted size-3 shrink-0" aria-hidden />
            </li>
          ))}
          <li className="min-w-0">
            <span aria-current="page" className={textRole('sectionTitle', 'block truncate')}>
              {current}
            </span>
          </li>
        </ol>
      </nav>
      {actions}
    </div>
  );
}
