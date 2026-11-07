'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { useAgentCatalog } from '@/components/agent/use-agent-catalog';
import { NavLink } from '@/components/layout/nav-link';
import { AGENT_NAV_ITEMS } from '@/components/layout/nav-items';
import { StationLinks } from '@/components/layout/sidebar-nav';
import {
  SidebarNavGroup,
  SidebarRecordMeta,
  SidebarRecordNotice,
  SidebarRecordRow,
  SidebarRecordRows,
  SidebarRecordSection,
} from '@/components/ui/app-shell';
import { Button } from '@/components/ui/button';
import { SearchField } from '@/components/ui/search-field';
import { agentQueries, type AgentChatSummary } from '@/lib/api/agent';
import { AGENT_CHAT_LIST_POLL_MS, AGENT_CHAT_SEARCH_DEBOUNCE_MS } from '@/lib/config/agent';
import { ICONS } from '@/lib/icons';
import { MODE_HOMES } from '@/lib/navigation/app-routes';
import { scopedNavigationDestination } from '@/lib/navigation/project-destination';
import { useRouteIntent } from '@/lib/navigation/use-route-intent';
import { useProjectContext } from '@/lib/project/project-context';

const AGENT_HOME = MODE_HOMES.agent;

/**
 * Agent mode: New chat, Actions (with the open count), Skills, Context, then
 * every chat in the project, newest activity first, searchable and paged.
 */
export function AgentNav() {
  const { activeProjectId, activeWorkspaceId } = useProjectContext();
  const scoped = (href: string) =>
    scopedNavigationDestination(href, 'project', activeProjectId, activeWorkspaceId);
  const pathname = useLocation().pathname ?? '';
  const onIntent = useRouteIntent();

  return (
    <nav aria-label="Agent" className="contents">
      <SidebarNavGroup>
        <li>
          <NavLink
            item={{
              label: 'New chat',
              href: scoped(AGENT_HOME),
              icon: ICONS.newChat,
              scope: 'project',
            }}
            active={pathname === AGENT_HOME}
            onIntent={onIntent}
          />
        </li>
        <StationLinks items={AGENT_NAV_ITEMS} />
      </SidebarNavGroup>
      {activeProjectId && activeWorkspaceId ? (
        <ChatHistory
          workspaceId={activeWorkspaceId}
          projectId={activeProjectId}
          pathname={pathname}
          scoped={scoped}
        />
      ) : null}
    </nav>
  );
}

function useDebounced(value: string): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), AGENT_CHAT_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [value]);
  return debounced;
}

function ChatHistory({
  workspaceId,
  projectId,
  pathname,
  scoped,
}: Readonly<{
  workspaceId: string;
  projectId: string;
  pathname: string;
  scoped: (href: string) => string;
}>) {
  const [search, setSearch] = useState('');
  const needle = useDebounced(search.trim());
  const chats = useInfiniteQuery({
    ...agentQueries.chats(workspaceId, projectId, { q: needle }),
    // Several chats can run at once; their markers clear as each turn ends.
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.items.some((chat) => chat.running))
        ? AGENT_CHAT_LIST_POLL_MS
        : false,
  });
  const rows = chats.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <SidebarRecordSection label="Chats">
      <SearchField
        value={search}
        onValueChange={setSearch}
        // Only a new search shows the spinner; background polls while a chat runs do not.
        pending={chats.isFetching && !chats.isFetchingNextPage && !chats.isRefetching}
        aria-label="Search chats"
        placeholder="Search chats"
      />
      <ChatRows
        rows={rows}
        state={chatListState(chats.isPending, chats.isError, needle)}
        pathname={pathname}
        scoped={scoped}
      />
      {chats.hasNextPage ? (
        <Button
          variant="ghost"
          disabled={chats.isFetchingNextPage}
          onClick={() => void chats.fetchNextPage()}
        >
          Show more chats
        </Button>
      ) : null}
    </SidebarRecordSection>
  );
}

function chatListState(pending: boolean, error: boolean, needle: string) {
  if (pending) return 'loading';
  if (error) return 'error';
  return needle ? 'filtered' : 'ready';
}

function ChatRows({
  rows,
  state,
  pathname,
  scoped,
}: Readonly<{
  rows: AgentChatSummary[];
  state: 'loading' | 'error' | 'filtered' | 'ready';
  pathname: string;
  scoped: (href: string) => string;
}>) {
  if (state === 'loading') return null;
  if (state === 'error')
    return <SidebarRecordNotice>Chats could not be loaded.</SidebarRecordNotice>;
  if (rows.length === 0)
    return (
      <SidebarRecordNotice>
        {state === 'filtered' ? 'No chats match this search.' : 'No chats yet.'}
      </SidebarRecordNotice>
    );
  return (
    <SidebarRecordRows>
      {rows.map((chat) => {
        const href = `/agent/chats/${chat.id}`;
        return (
          <SidebarRecordRow
            key={chat.id}
            href={scoped(href)}
            active={pathname === href}
            title={chat.title}
            meta={<ChatMeta chat={chat} />}
          />
        );
      })}
    </SidebarRecordRows>
  );
}

function ChatMeta({ chat }: Readonly<{ chat: AgentChatSummary }>) {
  const { kindLabel } = useAgentCatalog();
  const marker = chat.output_kind ? kindLabel(chat.output_kind) : null;
  return (
    <SidebarRecordMeta working={chat.running}>
      {[chat.target_label, marker].filter(Boolean).join(' · ')}
    </SidebarRecordMeta>
  );
}
