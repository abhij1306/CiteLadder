import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { SidebarIdentButton, SidebarTextTooltip } from '@/components/ui/sidebar';
import {
  Menu,
  MenuContent,
  MenuControlRow,
  MenuLabel,
  MenuLinkItem,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import { ThemeSwitch } from '@/components/ui/theme-switch';
import { useSession } from '@/lib/auth/session-guard';
import { scopedNavigationDestination } from '@/lib/navigation/project-destination';
import { useProjectContext } from '@/lib/project/project-context';
import { Avatar } from '@/components/ui/avatar';

import { ACCOUNT_MENU_ITEMS, isAccountCurrent, isNavItemActive } from './nav-items';

type UserMenuState = {
  email: string;
  activePresenter: UserMenuPresenter | null;
  setOpen: (presenter: UserMenuPresenter, open: boolean) => void;
};

type UserMenuPresenter = 'sidebar' | 'drawer' | 'compact';

const UserMenuContext = createContext<UserMenuState | null>(null);

function useUserMenu() {
  const state = useContext(UserMenuContext);
  if (!state) throw new Error('UserMenuTrigger must render inside UserMenuController.');
  return state;
}

function UserMenuContent({
  presenter,
  currentHref,
}: Readonly<{ presenter: UserMenuPresenter; currentHref?: string }>) {
  const { email } = useUserMenu();
  const { activeProjectId, activeWorkspaceId } = useProjectContext();
  const sidebar = presenter !== 'compact';
  return (
    <MenuContent align={sidebar ? 'start' : 'end'} side={sidebar ? 'top' : 'bottom'}>
      <MenuLabel>{email}</MenuLabel>
      <MenuSeparator />
      {ACCOUNT_MENU_ITEMS.map(({ label, href, icon: Icon, scope }) => (
        <MenuLinkItem key={href}>
          <Link
            to={scopedNavigationDestination(href, scope, activeProjectId, activeWorkspaceId)}
            aria-current={href === currentHref ? 'page' : undefined}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span>{label}</span>
          </Link>
        </MenuLinkItem>
      ))}
      <MenuSeparator />
      <MenuControlRow label="Theme">
        <ThemeSwitch tooltipSide="top" />
      </MenuControlRow>
    </MenuContent>
  );
}

export function UserMenuTrigger({ presenter }: Readonly<{ presenter: UserMenuPresenter }>) {
  const { activePresenter, email, setOpen } = useUserMenu();
  const { activeWorkspace } = useProjectContext();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const currentHref = ACCOUNT_MENU_ITEMS.filter((item) =>
    isNavItemActive(pathname, searchParams, item),
  ).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const open = activePresenter === presenter;
  const label = `Account menu for ${email}`;
  return (
    <Menu open={open} onOpenChange={(next) => setOpen(presenter, next)}>
      {presenter === 'compact' ? (
        <MenuTrigger
          aria-label={label}
          className="focus-ring not-data-[state=open]:hover:overlay-hover data-[state=open]:overlay-pressed rounded-control flex size-[var(--control-md)] shrink-0 items-center justify-center transition-colors"
        >
          <Avatar name={email} />
        </MenuTrigger>
      ) : (
        <SidebarTextTooltip inRail="only">
          <MenuTrigger asChild>
            <SidebarIdentButton
              aria-label={label}
              title={email}
              meta={activeWorkspace?.name}
              current={isAccountCurrent(pathname, searchParams)}
              lead={<Avatar name={email} />}
            />
          </MenuTrigger>
        </SidebarTextTooltip>
      )}
      <UserMenuContent presenter={presenter} currentHref={currentHref} />
    </Menu>
  );
}

export function UserMenuController({ children }: Readonly<{ children: ReactNode }>) {
  const { user } = useSession();
  const [activePresenter, setActivePresenter] = useState<UserMenuPresenter | null>(null);
  const setOpen = useCallback(
    (presenter: UserMenuPresenter, open: boolean) => setActivePresenter(open ? presenter : null),
    [],
  );

  const value = useMemo<UserMenuState>(
    () => ({ email: user.email, activePresenter, setOpen }),
    [user.email, activePresenter, setOpen],
  );

  return <UserMenuContext.Provider value={value}>{children}</UserMenuContext.Provider>;
}
