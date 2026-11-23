import type { ComponentType } from 'react';

import type { LoadingShape } from '@/components/ui/skeleton-block';
import type { IconName } from '@/lib/icons';

type RouteScope = 'public' | 'workspace' | 'project';

export type SidebarGroup =
  | 'home'
  | 'brand'
  | 'tracking'
  | 'website'
  | 'search'
  | 'commerce'
  | 'agent'
  | 'foot';

export type NavPlacement =
  | `sidebar:${SidebarGroup}`
  | `palette:${Exclude<SidebarGroup, 'agent' | 'foot'>}`
  | 'account'
  | 'palette';

export type NavEntry = {
  label: string;
  icon: IconName;
  search?: string;
  badge?: 'open-actions';
  hiddenWhenManaged?: true;
  listedLast?: true;
  placements: readonly NavPlacement[];
};

export type NavDestination = Pick<NavEntry, 'label' | 'icon' | 'badge' | 'hiddenWhenManaged'> & {
  href: string;
  scope: Exclude<RouteScope, 'public'>;
};

export type Screen = () => Promise<{ default: ComponentType }>;

export type RouteLoading =
  | Readonly<{
      kind: 'cards';
      tabs?: HeldTabs;
      rail?: HeldTabs;
      filters?: boolean;
      intro?: boolean;
      stacked?: boolean;
      shapes: readonly LoadingShape[];
    }>
  | Readonly<{ kind: 'overview' | 'issues' | 'thread' | 'new-chat' }>;

export type HeldTabs = Readonly<{
  param: string;
  items: readonly Readonly<{ value: string; label: string }>[];
}>;

export type AppRouteRecord = {
  path: string;
  title: string | null;
  scope: RouteScope;
  shell: boolean;
  screen: Screen;
  collection?: string;
  credentialInUrl?: true;
  nav?: readonly NavEntry[];
  loading?: RouteLoading;
  width?: 'narrow' | 'compact';
};
