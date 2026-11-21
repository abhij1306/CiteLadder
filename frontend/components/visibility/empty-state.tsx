import { FirstRunAction } from '@/components/runs/launch-audit-button';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ProjectLink } from '@/components/ui/project-link';
import { StateBlock } from '@/components/ui/state-block';
import { Activity, Rocket } from '@/lib/icons';
import { AUDIT_STATES } from '@/lib/runs/status';
import type { ActiveRun } from '@/lib/visibility/dashboard';
import { useWorkspaceCapability } from '@/lib/project/project-context';

export function VisibilityEmptyState({ activeRun }: Readonly<{ activeRun: ActiveRun | null }>) {
  const canRun = useWorkspaceCapability('run');
  if (activeRun)
    return (
      <StateBlock
        kind="empty"
        icon={Activity}
        heading="A run is in progress"
        description={AUDIT_STATES[activeRun.status].label}
        action={
          <Button asChild>
            <ProjectLink href={`/runs/${activeRun.id}`}>
              <Icon icon={Activity} />
              Watch live progress
            </ProjectLink>
          </Button>
        }
      />
    );
  return (
    <StateBlock
      kind="empty"
      icon={Rocket}
      heading="No visibility data yet"
      action={canRun ? <FirstRunAction /> : undefined}
    />
  );
}
