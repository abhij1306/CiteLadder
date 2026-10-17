'use client';

import type { ReactNode } from 'react';

import { filterChipClasses } from '@/components/ui/filter-chip-variants';
import { cn } from '@/lib/utils';

/** A compact toggle for filtering a data set without changing views. */
export function FilterChip({
  active,
  onClick,
  count,
  children,
  disabled = false,
  className,
}: Readonly<{
  active: boolean;
  onClick: () => void;
  count?: number;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}>) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        filterChipClasses(active),
        'disabled:cursor-not-allowed disabled:bg-disabled disabled:text-muted disabled:border-border-subtle',
        className,
      )}
    >
      {children}
      {typeof count === 'number' ? (
        <span
          className={cn(
            'type-badge tabular-nums',
            active && !disabled ? 'text-foreground' : 'text-muted',
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
