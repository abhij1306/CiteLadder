'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useAgentCatalog } from '@/components/agent/use-agent-catalog';
import { SearchField } from '@/components/ui/search-field';
import { Spinner } from '@/components/ui/spinner';
import { textRole } from '@/components/ui/typography';
import { OUTPUT_PHASE_LABEL } from '@/lib/agent/vocabulary';
import { agentQueries, type AgentChatSummary } from '@/lib/api/agent';
import { AGENT_CHAT_LIST_POLL_MS, AGENT_CHAT_SEARCH_DEBOUNCE_MS } from '@/lib/config/agent';
import { ICONS } from '@/lib/icons';
import { scopedNavigationDestination } from '@/lib/navigation/project-destination';
import { useRouteIntent } from '@/lib/navigation/use-route-intent';
import { useProjectContext } from '@/lib/project/project-context';
import { cn } from '@/lib/utils';

import { NavLink } from './nav-link';
import { AGENT_HOME, AGENT_NAV_ITEMS, isNavItemActive } from './nav-items';

/**
 * Agent mode: New chat, Actions (with the open count), Skills, Context, then
 * every chat in the project, newest activity first, searchable and paged.
 */
export function AgentNav({ onNavigate }: Readonly<{ onNavigate?: () => void }>) {
  const { activeProjectId, activeWorkspaceId } = useProjectContext();
  const scoped = (href: string) =>
    scopedNavigationDestination(href, 'project', activeProjectId, activeWorkspaceId);
  const pathname = useLocation().pathname ?? '';
  const searchParams = useSearchParams()[0];
  const onIntent = useRouteIntent();
  const NewChatIcon = ICONS.newChat;

  return (
    <nav aria-label="Agent" className="flex min-h-0 flex-col gap-3">
      <Button asChild size="md" className="w-full justify-start">
        <Link to={scoped(AGENT_HOME)} onClick={onNavigate}>
          <NewChatIcon className="size-4" aria-hidden />
          New chat
        </Link>
      </Button>
      <ul className="flex flex-col gap-[var(--sidebar-item-gap)]">
        {AGENT_NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <NavLink
              item={{ ...item, href: scoped(item.href) }}
              active={isNavItemActive(pathname, searchParams, item)}
              onIntent={onIntent}
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </ul>
      {activeProjectId && activeWorkspaceId ? (
        <ChatHistory
          workspaceId={activeWorkspaceId}
          projectId={activeProjectId}
          pathname={pathname}
          scoped={scoped}
          onNavigate={onNavigate}
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
  onNavigate,
}: Readonly<{
  workspaceId: string;
  projectId: string;
  pathname: string;
  scoped: (href: string) => string;
  onNavigate?: () => void;
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
    <section aria-labelledby="agent-chat-history" className="flex min-h-0 flex-col gap-2">
      <h2 id="agent-chat-history" className={textRole('label', 'text-secondary px-3 pt-2')}>
        Chats
      </h2>
      <SearchField
        value={search}
        onValueChange={setSearch}
        // Only a new search shows the spinner; background polls while a chat runs do not.
        pending={chats.isFetching && !chats.isFetchingNextPage && !chats.isRefetching}
        aria-label="Search chats"
        placeholder="Search chats"
        size="compact"
      />
      <ChatRows
        rows={rows}
        state={chatListState(chats.isPending, chats.isError, needle)}
        pathname={pathname}
        scoped={scoped}
        onNavigate={onNavigate}
      />
      {chats.hasNextPage ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={chats.isFetchingNextPage}
          onClick={() => void chats.fetchNextPage()}
        >
          Show more chats
        </Button>
      ) : null}
    </section>
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
  onNavigate,
}: Readonly<{
  rows: AgentChatSummary[];
  state: 'loading' | 'error' | 'filtered' | 'ready';
  pathname: string;
  scoped: (href: string) => string;
  onNavigate?: () => void;
}>) {
  if (state === 'loading') return null;
  if (state === 'error')
    return <p className={textRole('caption', 'px-3')}>Chats could not be loaded.</p>;
  if (rows.length === 0)
    return (
      <p className={textRole('caption', 'px-3')}>
        {state === 'filtered' ? 'No chats match this search.' : 'No chats yet.'}
      </p>
    );
  return (
    <ul className="flex flex-col gap-[var(--sidebar-item-gap)]">
      {rows.map((chat) => {
        const href = `/agent/chats/${chat.id}`;
        const active = pathname === href;
        return (
          <li key={chat.id}>
            <Link
              to={scoped(href)}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'focus-ring grid gap-0.5 rounded-[var(--radius-control)] border px-3 py-2',
                active
                  ? 'border-transparent bg-selected text-foreground active:bg-active'
                  : 'hover:bg-hover active:bg-active border-transparent text-secondary',
              )}
            >
              <span className={textRole('label', 'truncate text-foreground')}>{chat.title}</span>
              <ChatMeta chat={chat} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ChatMeta({ chat }: Readonly<{ chat: AgentChatSummary }>) {
  const { kindLabel } = useAgentCatalog();
  const marker =
    chat.output_kind && chat.output_phase
      ? `${kindLabel(chat.output_kind)} · ${OUTPUT_PHASE_LABEL[chat.output_phase]}`
      : null;
  if (chat.running)
    return (
      <span className={textRole('caption', 'flex items-center gap-2')}>
        <Spinner className="text-muted" />
        Working…
      </span>
    );
  if (!chat.target_label && !marker) return null;
  return (
    <span className={textRole('caption', 'truncate')}>
      {[chat.target_label, marker].filter(Boolean).join(' · ')}
    </span>
  );
}
