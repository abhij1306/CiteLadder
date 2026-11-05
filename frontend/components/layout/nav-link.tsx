'use client';

import { lazy } from 'react';
import { Link } from 'react-router-dom';

import {
  SidebarNavRowContent,
  SidebarRowTooltip,
  sidebarNavRowClasses,
} from '@/components/ui/app-shell';
import { LazyIsland } from '@/components/ui/lazy-island';

import type { NavItem } from './nav-items';

/**
 * The count reads the Actions list, whose client and schemas (Actions,
 * Opportunities, Site Health) would otherwise ride in the boot download. It
 * arrives after the shell; until its read answers it renders nothing, which is
 * also what it renders while the code loads, and it sits in the row's fixed
 * count slot, so its arrival moves nothing.
 */
const OpenActionCount = lazy(() =>
  import('./open-action-count').then(({ OpenActionCount }) => ({ default: OpenActionCount })),
);

/** One shell destination row, shared by Dashboard and Agent navigation. */
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
          active={active}
          count={
            item.badge === 'open-actions' ? (
              // Chrome: a count that cannot load or render is reported and
              // leaves the row as it was; it never takes the shell down.
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
