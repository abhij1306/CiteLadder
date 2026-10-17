import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

/**
 * InlineEmpty — the one-line "No …" inside a section or card that otherwise
 * has content: "No orphaned pages.", "No competitor rates yet."
 *
 * One role: `body` in muted ink, with an optional leading icon and one
 * trailing action.
 *
 * A region whose whole purpose is empty (first use, no results for a filter)
 * is an `EmptyState`, not this.
 */
export function InlineEmpty({
  children,
  icon: Icon,
  action,
  className,
}: Readonly<{
  /** One short sentence: what is absent. */
  children: ReactNode;
  icon?: LucideIcon;
  /** One small control (a `TextLink` or `sm` button). */
  action?: ReactNode;
  className?: string;
}>) {
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1', className)}>
      {Icon ? <Icon className="text-muted size-4 shrink-0" aria-hidden /> : null}
      <p className={textRole('body', 'text-muted min-w-0')}>{children}</p>
      {action}
    </div>
  );
}
