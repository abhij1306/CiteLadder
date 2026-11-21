import { lazy, Suspense, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { isAgentPath } from '@/lib/navigation/app-routes';
import { ActionButton } from '@/components/ui/actions';
import { MASTHEAD_LABELLED } from '@/components/ui/masthead';
import { Tooltip } from '@/components/ui/tooltip';
import { useAgentPanel } from '@/lib/agent/panel-context';
import { useProjectContext } from '@/lib/project/project-context';

const AgentPanel = lazy(() =>
  import('./agent-panel').then(({ AgentPanel }) => ({ default: AgentPanel })),
);

function usePanelAvailable(): boolean {
  const pathname = useLocation().pathname ?? '';
  const { activeProjectId, activeWorkspaceId } = useProjectContext();
  return Boolean(activeProjectId && activeWorkspaceId) && !isAgentPath(pathname);
}

export function AgentPanelTrigger() {
  const panel = useAgentPanel();
  if (!panel) return null;
  return <PanelTrigger open={() => panel.setOpen(true)} />;
}

function PanelTrigger({ open }: Readonly<{ open: () => void }>) {
  const available = usePanelAvailable();
  if (!available) return null;
  return (
    <Tooltip content="Ask the agent about this screen" side="bottom">
      <ActionButton
        action="askAgent"
        aria-haspopup="dialog"
        onClick={open}
        className={MASTHEAD_LABELLED}
      />
    </Tooltip>
  );
}

export function AgentPanelHost() {
  const open = useAgentPanel()?.open ?? false;
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  if (!opened) return null;
  return (
    <Suspense fallback={null}>
      <AgentPanel />
    </Suspense>
  );
}
