import { lazy, Suspense, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { navigationMode } from '@/lib/navigation/app-routes';
import { IconButton } from '@/components/ui/button';
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

/**
 * The page header's button that opens the agent panel on Dashboard screens.
 * The header draws it on every page; a page rendered outside the shell (a
 * preview, a test) has no panel and so no trigger, and never reads the
 * project context it lacks.
 */
export function AgentPanelTrigger() {
  const panel = useAgentPanel();
  if (!panel) return null;
  return <PanelTrigger open={() => panel.setOpen(true)} />;
}

function PanelTrigger({ open }: Readonly<{ open: () => void }>) {
  const available = useDashboardProject();
  if (!available) return null;
  return (
    <Tooltip content="Ask the agent about this screen" side="bottom">
      <IconButton
        icon={ICONS.agent}
        label="Open agent"
        tooltip={false}
        aria-haspopup="dialog"
        onClick={open}
      />
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
