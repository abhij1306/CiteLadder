import { lazy } from 'react';

import { AGENT_NAV_ITEMS, NEW_CHAT_ITEM } from '@/components/layout/nav-items';
import { DestinationRows, useDestinations } from '@/components/layout/sidebar-nav';
import { RailLink } from '@/components/layout/sidebar-rail';
import { LazyIsland } from '@/components/ui/lazy-island';
import { SidebarNavGroup, SidebarScrollList } from '@/components/ui/sidebar';
import { useProjectContext } from '@/lib/project/project-context';

const ChatSection = lazy(() =>
  import('./agent-chat-list').then((module) => ({ default: module.ChatSection })),
);
const ChatsFlyout = lazy(() =>
  import('./agent-chat-list').then((module) => ({ default: module.ChatsFlyout })),
);

export function AgentNav() {
  const { location } = useDestinations();
  const { activeWorkspaceId, activeProjectId } = useProjectContext();
  return (
    <SidebarScrollList label="Agent" revealKey={location}>
      <SidebarNavGroup>
        <DestinationRows items={[NEW_CHAT_ITEM, ...AGENT_NAV_ITEMS]} />
      </SidebarNavGroup>
      {activeWorkspaceId && activeProjectId ? (
        <LazyIsland failed={null} label="agent-chat-list" defects="contain">
          <ChatSection />
        </LazyIsland>
      ) : null}
    </SidebarScrollList>
  );
}

export function AgentRail() {
  const { isActive, href } = useDestinations();
  const { activeWorkspaceId, activeProjectId } = useProjectContext();
  return (
    <>
      {[NEW_CHAT_ITEM, ...AGENT_NAV_ITEMS].map((item) => (
        <li key={item.href}>
          <RailLink item={{ ...item, href: href(item) }} active={isActive(item)} />
        </li>
      ))}
      {activeWorkspaceId && activeProjectId ? (
        <li>
          <LazyIsland failed={null} label="agent-chat-list" defects="contain">
            <ChatsFlyout />
          </LazyIsland>
        </li>
      ) : null}
    </>
  );
}
