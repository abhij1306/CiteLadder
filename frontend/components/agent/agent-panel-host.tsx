'use client';

import { lazy, Suspense, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { navigationMode } from '@/components/layout/nav-items';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { useAgentPanel } from '@/lib/agent/panel-context';
import { ICONS } from '@/lib/icons';
import { useProjectContext } from '@/lib/project/project-context';

// The panel renders chats (markdown, composer, skills); it stays out of the
// chunk the shell needs before it can paint and loads on first open.
const AgentPanel = lazy(() =>
  import('./agent-panel').then(({ AgentPanel }) => ({ default: AgentPanel })),
);

function useDashboardProject(): boolean {
  const pathname = useLocation().pathname ?? '';
  const { activeProjectId, activeWorkspaceId } = useProjectContext();
  return Boolean(activeProjectId && activeWorkspaceId) && navigationMode(pathname) === 'dashboard';
}

/** The top-bar button that opens the agent panel on Dashboard screens. */
export function AgentPanelTrigger() {
  const panel = useAgentPanel();
  const available = useDashboardProject();
  if (!panel || !available) return null;
  const Icon = ICONS.agent;
  return (
    <Tooltip content="Ask the agent about this screen" side="bottom">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open agent"
        aria-haspopup="dialog"
        onClick={() => panel.setOpen(true)}
      >
        <Icon className="size-4" aria-hidden />
      </Button>
    </Tooltip>
  );
}

/** Mounts the panel once it is first opened, then keeps it for its transitions. */
export function AgentPanelHost() {
  const open = useAgentPanel()?.open ?? false;
  const [opened, setOpened] = useState(open);
  // Adjusted during render, so the first open mounts the panel in one pass.
  if (open && !opened) setOpened(true);
  if (!opened) return null;
  return (
    <Suspense fallback={null}>
      <AgentPanel />
    </Suspense>
  );
}
