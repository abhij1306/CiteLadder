'use client';

import { Plug } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from '@/components/ui/dropdown';
import { useSession } from '@/lib/auth/session-guard';
import { ICONS } from '@/lib/icons';
import { workspaceDestination } from '@/lib/navigation/project-destination';
import { useProjectContext } from '@/lib/project/project-context';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';

const SettingsIcon = ICONS.settings;

type UserMenuState = {
  email: string;
  activePresenter: UserMenuPresenter | null;
  setOpen: (presenter: UserMenuPresenter, open: boolean) => void;
};

type UserMenuPresenter = 'sidebar' | 'compact' | 'header';

const UserMenuContext = createContext<UserMenuState | null>(null);

function useUserMenu() {
  const state = useContext(UserMenuContext);
  if (!state) throw new Error('UserMenuTrigger must render inside UserMenuController.');
  return state;
}

function UserMenuContent({ presenter }: Readonly<{ presenter: UserMenuPresenter }>) {
  const { email } = useUserMenu();
  const { activeWorkspaceId } = useProjectContext();
  const compact = presenter !== 'sidebar';
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
    <DropdownContent
      align={compact ? 'end' : 'start'}
      side={compact ? 'bottom' : 'top'}
      width="panel"
    >
      <DropdownLabel>{email}</DropdownLabel>
      <DropdownSeparator />
      <DropdownItem asChild>
        <Link to={settingsHref}>
          <SettingsIcon className="size-4 shrink-0" aria-hidden />
          <span>Settings</span>
        </Link>
      </DropdownItem>
      <DropdownItem asChild>
        <Link to={connectHref}>
          <Plug className="size-4 shrink-0" aria-hidden />
          <span>Connect AI assistants</span>
        </Link>
      </DropdownItem>
    </DropdownContent>
  );
}

export function UserMenuTrigger({
  className,
  presenter,
}: Readonly<{ className?: string; presenter: UserMenuPresenter }>) {
  const { activePresenter, email, setOpen } = useUserMenu();
  const open = activePresenter === presenter;
  const compact = presenter !== 'sidebar';
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Dropdown open={open} onOpenChange={(next) => setOpen(presenter, next)}>
        <DropdownTrigger
          aria-label={compact ? `Account menu for ${email}` : undefined}
          className={cn(
            'focus-ring hover:bg-hover active:bg-active data-[state=open]:bg-selected hover:text-foreground flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] text-left transition-colors',
            compact
              ? 'size-[var(--control-height-md)] shrink-0 justify-center'
              : 'h-[var(--control-height-md)] flex-1 px-2',
          )}
        >
          <Avatar name={email} />
          {compact ? null : <span className="type-body min-w-0 flex-1 truncate">{email}</span>}
        </DropdownTrigger>
        {open ? <UserMenuContent presenter={presenter} /> : null}
      </Dropdown>
    </div>
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
