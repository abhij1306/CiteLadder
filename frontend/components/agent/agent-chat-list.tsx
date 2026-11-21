import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { RailFlyout } from '@/components/layout/sidebar-rail';
import { Button } from '@/components/ui/button';
import { DisplayTime } from '@/components/ui/display-time';
import { Icon } from '@/components/ui/icon';
import {
  HistoryFailed,
  HistoryList,
  HistoryNotice,
  HistoryRow,
  HistoryRows,
} from '@/components/ui/history-list';
import { MenuItem, MenuLinkItem } from '@/components/ui/menu';
import { SearchField } from '@/components/ui/search-field';
import { RailFlyoutSlot } from '@/components/ui/sidebar';
import { Spinner } from '@/components/ui/spinner';
import { InlineFigure } from '@/components/ui/typography';
import { ChevronDown, MessagesSquare, RefreshCw } from '@/lib/icons';
import { CHAT_ORIGIN_LABELS } from '@/lib/agent/handoff';
import { isChatLiveTurnConnected, onLiveTurnClosed } from '@/lib/agent/live-turns';
import { agentQueries, type AgentChatSummary } from '@/lib/api/agent';
import { AGENT_CHAT_LIST_POLL_MS, AGENT_CHAT_SEARCH_DEBOUNCE_MS } from '@/lib/config/agent';
import { useProjectHref } from '@/lib/navigation/project-destination';
import { useProjectContext } from '@/lib/project/project-context';
import { useDebounced } from '@/lib/use-debounced';

function useChatList() {
  const { activeWorkspaceId, activeProjectId } = useProjectContext();
  const [search, setSearch] = useState('');
  const needle = useDebounced(search.trim(), AGENT_CHAT_SEARCH_DEBOUNCE_MS);
  const chats = useInfiniteQuery({
    ...agentQueries.chats(
      { workspaceId: activeWorkspaceId ?? '', projectId: activeProjectId ?? '' },
      { q: needle },
    ),
    enabled: Boolean(activeWorkspaceId && activeProjectId),
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.items.some((chat) => chat.running && !isChatLiveTurnConnected(chat.id)),
      )
        ? AGENT_CHAT_LIST_POLL_MS
        : false,
  });
  const { refetch } = chats;
  useEffect(() => onLiveTurnClosed(() => void refetch()), [refetch]);
  const rows = chats.data?.pages.flatMap((page) => page.items) ?? [];
  let state: 'loading' | 'error' | 'filtered' | 'ready' = needle ? 'filtered' : 'ready';
  if (chats.isPending) state = 'loading';
  else if (chats.isError) state = 'error';
  return {
    search,
    setSearch,
    rows,
    state,
    searching: chats.isFetching && !chats.isFetchingNextPage && !chats.isRefetching,
    more: chats.hasNextPage
      ? { busy: chats.isFetchingNextPage, load: () => void chats.fetchNextPage() }
      : null,
    retry: () => void chats.refetch(),
  };
}

type ChatList = ReturnType<typeof useChatList>;

function chatListNotice(list: ChatList): string | null {
  if (list.state === 'error' || list.state === 'loading' || list.rows.length > 0) return null;
  return list.state === 'filtered' ? 'No chats match this search.' : 'No chats yet.';
}

const LOAD_FAILED = "Couldn't load chats.";

function ChatListError({ onRetry }: Readonly<{ onRetry: () => void }>) {
  return (
    <HistoryFailed
      message={LOAD_FAILED}
      retry={
        <Button variant="quiet" onClick={onRetry}>
          <Icon icon={RefreshCw} />
          Retry
        </Button>
      }
    />
  );
}

function ChatSearch({
  list,
  onKeyDown,
}: Readonly<{ list: ChatList; onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void }>) {
  return (
    <SearchField
      value={list.search}
      onValueChange={list.setSearch}
      pending={list.searching}
      onKeyDown={onKeyDown}
      aria-label="Search chats"
      placeholder="Search chats"
    />
  );
}

function ChatMeta({ chat }: Readonly<{ chat: AgentChatSummary }>) {
  return (
    <>
      {CHAT_ORIGIN_LABELS[chat.origin]} ·{' '}
      <InlineFigure>
        <DisplayTime value={chat.last_activity_at} dateOnly />
      </InlineFigure>
    </>
  );
}

export function ChatSection() {
  const list = useChatList();
  const projectHref = useProjectHref();
  const pathname = useLocation().pathname ?? '';
  const notice = chatListNotice(list);
  return (
    <HistoryList
      search={<ChatSearch list={list} />}
      more={
        list.more ? (
          <Button variant="quiet" disabled={list.more.busy} onClick={list.more.load}>
            <Icon icon={ChevronDown} />
            Show more chats
          </Button>
        ) : null
      }
    >
      {notice ? <HistoryNotice>{notice}</HistoryNotice> : null}
      {list.state === 'error' ? <ChatListError onRetry={list.retry} /> : null}
      {list.rows.length > 0 ? (
        <HistoryRows label="Chats">
          {list.rows.map((chat) => {
            const href = `/agent/chats/${chat.id}`;
            return (
              <HistoryRow
                key={chat.id}
                href={projectHref(href)}
                active={pathname === href}
                title={chat.title}
                meta={<ChatMeta chat={chat} />}
                working={chat.running}
              />
            );
          })}
        </HistoryRows>
      ) : null}
    </HistoryList>
  );
}

/** The search field types freely: the menu's typeahead must not take its letters. */
function keepTyping(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key.length === 1 || event.key === 'Backspace' || event.key === ' ') {
    event.stopPropagation();
  }
}

export function ChatsFlyout() {
  const list = useChatList();
  const projectHref = useProjectHref();
  const pathname = useLocation().pathname ?? '';
  const notice = chatListNotice(list);
  const current = pathname.startsWith('/agent/chats/');
  return (
    <RailFlyout label="Chats" icon={MessagesSquare} current={current}>
      <RailFlyoutSlot>
        <ChatSearch list={list} onKeyDown={keepTyping} />
      </RailFlyoutSlot>
      {notice ? (
        <RailFlyoutSlot>
          <HistoryNotice>{notice}</HistoryNotice>
        </RailFlyoutSlot>
      ) : null}
      {list.state === 'error' ? (
        <>
          <RailFlyoutSlot>
            <HistoryNotice>{LOAD_FAILED}</HistoryNotice>
          </RailFlyoutSlot>
          <MenuItem
            icon={<Icon icon={RefreshCw} />}
            onSelect={(event) => {
              event.preventDefault();
              list.retry();
            }}
          >
            Retry
          </MenuItem>
        </>
      ) : null}
      {list.rows.map((chat) => {
        const href = `/agent/chats/${chat.id}`;
        return (
          <MenuLinkItem key={chat.id}>
            <Link to={projectHref(href)} aria-current={pathname === href ? 'page' : undefined}>
              <span className="min-w-0 flex-1 truncate" title={chat.title}>
                {chat.title}
              </span>
              {chat.running ? <Spinner label="Working" /> : null}
            </Link>
          </MenuLinkItem>
        );
      })}
      {list.more ? (
        <MenuItem
          disabled={list.more.busy}
          onSelect={(event) => {
            event.preventDefault();
            list.more?.load();
          }}
        >
          Show more chats
        </MenuItem>
      ) : null}
    </RailFlyout>
  );
}
