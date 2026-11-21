import { lazy } from 'react';
import { Link } from 'react-router-dom';

import { LazyIsland } from '@/components/ui/lazy-island';
import {
  SidebarNavRowContent,
  SidebarRowTooltip,
  sidebarNavRowClasses,
} from '@/components/ui/sidebar';

import type { NavItem } from './nav-items';

const OpenActionCount = lazy(() =>
  import('./open-action-count').then(({ OpenActionCount }) => ({ default: OpenActionCount })),
);

export function NavLink({
  item,
  active,
  onIntent,
}: Readonly<{
  item: NavItem;
  active: boolean;
  onIntent: (href: string) => void;
}>) {
  return (
    <SidebarRowTooltip label={item.label}>
      <Link
        to={item.href}
        onMouseEnter={() => {
          if (!active) onIntent(item.href);
        }}
        onFocus={() => {
          if (!active) onIntent(item.href);
        }}
        aria-current={active ? 'page' : undefined}
        className={sidebarNavRowClasses(active)}
      >
        <SidebarNavRowContent
          icon={item.icon}
          label={item.label}
          count={
            item.badge === 'open-actions' ? (
              <LazyIsland failed={null} label="open-action-count" defects="contain">
                <OpenActionCount />
              </LazyIsland>
            ) : null
          }
        />
      </Link>
    </SidebarRowTooltip>
  );
}
