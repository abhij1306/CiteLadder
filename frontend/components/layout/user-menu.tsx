'use client';

import { Plug } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { SidebarIdentButton, SidebarRowTooltip } from '@/components/ui/app-shell';
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
import { ICONS } from '@/lib/icons';
import { workspaceDestination } from '@/lib/navigation/project-destination';
import { useProjectContext } from '@/lib/project/project-context';
import { Avatar } from '@/components/ui/avatar';

const SettingsIcon = ICONS.settings;

type UserMenuState = {
  email: string;
  activePresenter: UserMenuPresenter | null;
  setOpen: (presenter: UserMenuPresenter, open: boolean) => void;
};

type UserMenuPresenter = 'sidebar' | 'compact';

const UserMenuContext = createContext<UserMenuState | null>(null);

function useUserMenu() {
  const state = useContext(UserMenuContext);
  if (!state) throw new Error('UserMenuTrigger must render inside UserMenuController.');
  return state;
}

function UserMenuContent({ presenter }: Readonly<{ presenter: UserMenuPresenter }>) {
  const { email } = useUserMenu();
  const { activeWorkspaceId } = useProjectContext();
  const sidebar = presenter === 'sidebar';
  const settingsHref = activeWorkspaceId
    ? workspaceDestination('/settings', null, activeWorkspaceId)
    : '/settings';
  const connectHref = activeWorkspaceId
    ? workspaceDestination(
        '/settings',
        new URLSearchParams({ tab: 'connections' }),
        activeWorkspaceId,
      )
    : '/settings?tab=connections';
  return (
    <MenuContent align={sidebar ? 'start' : 'end'} side={sidebar ? 'top' : 'bottom'}>
      <MenuLabel>{email}</MenuLabel>
      <MenuSeparator />
      <MenuLinkItem>
        <Link to={settingsHref}>
          <SettingsIcon className="size-4 shrink-0" aria-hidden />
          <span>Settings</span>
        </Link>
      </MenuLinkItem>
      <MenuLinkItem>
        <Link to={connectHref}>
          <Plug className="size-4 shrink-0" aria-hidden />
          <span>Connect AI assistants</span>
        </Link>
      </MenuLinkItem>
      <MenuSeparator />
      <MenuControlRow label="Theme">
        <ThemeSwitch tooltipSide="top" />
      </MenuControlRow>
    </MenuContent>
  );
}

/**
 * The account trigger. In the sidebar it is the system's identity button
 * (the email over the workspace, an avatar in the rail); in a signed-in flow
 * bar it is the avatar alone.
 */
export function UserMenuTrigger({ presenter }: Readonly<{ presenter: UserMenuPresenter }>) {
  const { activePresenter, email, setOpen } = useUserMenu();
  const { activeWorkspace } = useProjectContext();
  const open = activePresenter === presenter;
  const label = `Account menu for ${email}`;
  return (
    <Menu open={open} onOpenChange={(next) => setOpen(presenter, next)}>
      {presenter === 'sidebar' ? (
        <SidebarRowTooltip label={email}>
          <MenuTrigger asChild>
            <SidebarIdentButton
              aria-label={label}
              title={email}
              meta={activeWorkspace?.name}
              lead={<Avatar name={email} />}
            />
          </MenuTrigger>
        </SidebarRowTooltip>
      ) : (
        <MenuTrigger
          aria-label={label}
          className="focus-ring hover:bg-surface-sunken data-[state=open]:bg-surface-sunken flex size-[var(--control-md)] shrink-0 items-center justify-center rounded-md transition-colors"
        >
          <Avatar name={email} />
        </MenuTrigger>
      )}
      {open ? <UserMenuContent presenter={presenter} /> : null}
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
