'use client';

import { Link } from 'react-router-dom';

import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

import type { NavItem } from './nav-items';
import { OpenActionCount } from './open-action-count';

/** One shell destination row, shared by Dashboard and Agent navigation. */
export function NavLink({
  item,
  active,
  onIntent,
  onNavigate,
}: Readonly<{
  item: NavItem;
  active: boolean;
  onIntent: (href: string) => void;
  onNavigate?: () => void;
}>) {
  const Icon = item.icon;
  return (
    <Link
      to={item.href}
      onMouseEnter={() => {
        if (!active) onIntent(item.href);
      }}
      onFocus={() => {
        if (!active) onIntent(item.href);
      }}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'shell-link focus-ring group relative flex h-[var(--nav-item-height)] items-center gap-2 rounded-[var(--radius-control)] px-3 transition-colors duration-[var(--motion-fast)]',
        // Current destinations use neutral selection; hover remains a lighter tint.
        active
          ? textRole('control', 'bg-selected text-foreground active:bg-active')
          : textRole(
              'control',
              'text-secondary hover:bg-hover active:bg-active hover:text-foreground',
            ),
      )}
    >
      <Icon
        className={cn(
          'size-4 shrink-0 transition-colors duration-[var(--motion-fast)]',
          active ? 'text-foreground' : 'text-muted group-hover:text-foreground',
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.badge === 'open-actions' ? <OpenActionCount /> : null}
    </Link>
  );
}
