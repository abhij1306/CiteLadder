import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import { NoticeScreen } from '@/components/templates/notice-page';
import { AppShellPlaceholder } from '@/components/ui/app-shell';
import {
  SidebarFrame,
  SidebarIdentButton,
  SidebarNavGroup,
  SidebarNavRowContent,
  SidebarRailList,
  SidebarScrollList,
  sidebarModeSegmentClasses,
  sidebarModeTrackClasses,
  sidebarNavRowClasses,
  sidebarRailButtonClasses,
} from '@/components/ui/sidebar';
import { MessagesSquare, type IconGlyph } from '@/lib/icons';
import { hasPageTitle, navigationMode } from '@/lib/navigation/app-routes';
import { isGroupFolded } from '@/lib/navigation/sidebar-folds';
import { useSidebarCollapsed } from '@/lib/sidebar-width';

import {
  AGENT_NAV_ITEMS,
  DASHBOARD_GROUPS,
  FOOT_NAV_ITEMS,
  isNavItemActive,
  NEW_CHAT_ITEM,
  type NavItem,
} from './nav-items';
import { MODES } from './mode-switch';
import { RouteLoadingScreen } from './page-shell';
import { ShellContext } from './shell-context';

export function ShellFallback({ children }: Readonly<{ children?: ReactNode }>) {
  return (
    <ShellContext.Provider value={FALLBACK_SHELL}>
      <AppShellPlaceholder busy={children === undefined} sidebar={<PlaceholderSidebar />}>
        {children === undefined ? <DestinationLoading /> : children}
      </AppShellPlaceholder>
    </ShellContext.Provider>
  );
}

const FALLBACK_SHELL = {
  navDrawer: { open: false, onOpen: () => {} },
  searchTrigger: null,
  agentTrigger: null,
} as const;

function DestinationLoading() {
  const { pathname } = useLocation();
  return hasPageTitle(pathname ?? '') ? (
    <RouteLoadingScreen />
  ) : (
    <NoticeScreen tone="loading" heading="Loading your workspace…" />
  );
}

function IdentBlock() {
  return (
    <SidebarIdentButton
      pending
      tabIndex={-1}
      title=""
      lead={<span aria-hidden className="bg-well rounded-mark size-5 shrink-0" />}
    />
  );
}

function Rows({ items, pathname }: Readonly<{ items: readonly NavItem[]; pathname: string }>) {
  const query = new URLSearchParams();
  return items.map((item) => (
    <li key={item.href}>
      <span
        aria-current={isNavItemActive(pathname, query, item) ? 'page' : undefined}
        className={sidebarNavRowClasses(isNavItemActive(pathname, query, item))}
      >
        <SidebarNavRowContent icon={item.icon} label={item.label} />
      </span>
    </li>
  ));
}

function PlaceholderSidebar() {
  const pathname = useLocation().pathname ?? '';
  const rail = useSidebarCollapsed();
  const mode = navigationMode(pathname);
  const query = new URLSearchParams();
  const current = (item: Pick<NavItem, 'href'>) => isNavItemActive(pathname, query, item);
  let nav: ReactNode;
  if (rail) {
    type RailFace = Readonly<{ label: string; icon: IconGlyph }>;
    const buttons: readonly RailFace[] =
      mode === 'agent'
        ? [NEW_CHAT_ITEM, ...AGENT_NAV_ITEMS, { label: 'Chats', icon: MessagesSquare }]
        : DASHBOARD_GROUPS.map((group) => ({ label: group.title, icon: group.icon }));
    nav = (
      <SidebarRailList label="Navigation">
        {buttons.map(({ label, icon: Icon }) => (
          <li key={label}>
            <span className={sidebarRailButtonClasses(false)}>
              <Icon aria-hidden />
            </span>
          </li>
        ))}
      </SidebarRailList>
    );
  } else {
    nav = (
      <SidebarScrollList label="Navigation" revealKey={pathname}>
        {mode === 'agent' ? (
          <SidebarNavGroup>
            <Rows items={[NEW_CHAT_ITEM, ...AGENT_NAV_ITEMS]} pathname={pathname} />
          </SidebarNavGroup>
        ) : (
          DASHBOARD_GROUPS.map((group) => (
            <SidebarNavGroup
              key={group.group}
              title={group.title}
              expanded={!isGroupFolded(group.group)}
            >
              <Rows
                items={isGroupFolded(group.group) ? group.items.filter(current) : group.items}
                pathname={pathname}
              />
            </SidebarNavGroup>
          ))
        )}
      </SidebarScrollList>
    );
  }
  return (
    <SidebarFrame
      ident={<IdentBlock />}
      mode={
        <div className={sidebarModeTrackClasses(rail)}>
          {MODES.map(({ mode: key, label, icon: Icon }) => (
            <span key={key} className={sidebarModeSegmentClasses(key === mode, rail)}>
              {rail ? <Icon aria-hidden /> : null}
              <span className={rail ? 'sr-only' : 'min-w-0 truncate'}>{label}</span>
            </span>
          ))}
        </div>
      }
      nav={nav}
      foot={
        <ul className={rail ? 'flex flex-col items-center' : 'flex flex-col gap-0.5'}>
          {rail ? (
            FOOT_NAV_ITEMS.map(({ href, icon: Icon }) => (
              <li key={href}>
                <span className={sidebarRailButtonClasses(current({ href }))}>
                  <Icon aria-hidden />
                </span>
              </li>
            ))
          ) : (
            <Rows items={FOOT_NAV_ITEMS} pathname={pathname} />
          )}
        </ul>
      }
      account={<IdentBlock />}
    />
  );
}
