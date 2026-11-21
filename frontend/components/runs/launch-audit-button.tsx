import { useNavigate } from 'react-router-dom';
import { useId, useState, type ComponentProps } from 'react';
import { useQuery } from '@tanstack/react-query';

import { ActionButton } from '@/components/ui/actions';
import type { ButtonProps } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { promptsQueries } from '@/lib/api/prompts';
import { useProjectHref } from '@/lib/navigation/project-destination';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useActiveProject, useWorkspaceCapability } from '@/lib/project/project-context';
import { launchReadiness, type LaunchReadiness } from '@/lib/runs/launch';

import { LaunchDialog } from './launch-dialog';

type LaunchRunProps = Omit<
  ButtonProps,
  'variant' | 'asChild' | 'children' | 'onClick' | 'disabled'
> &
  Pick<ComponentProps<typeof ActionButton>, 'secondary'>;

const PROMPTS_HREF = '/prompts';

export function useLaunchReadiness(projectId: string): LaunchReadiness {
  const { workspaceId } = useProjectScope();
  const setsQuery = useQuery({
    ...promptsQueries.sets({ workspaceId, projectId }),
    retryOnMount: false,
  });
  return launchReadiness(
    setsQuery.status === 'success'
      ? { status: 'success', promptSets: setsQuery.data.prompt_sets }
      : { status: setsQuery.status },
  );
}

export function LaunchAuditButton(props: Readonly<LaunchRunProps>) {
  const canRun = useWorkspaceCapability('run');
  const project = useActiveProject();
  if (!canRun) return null;
  if (!project) return <ActionButton action="launchRun" {...props} disabled />;
  return <LaunchAudit {...props} projectId={project.id} />;
}

export function FirstRunAction() {
  const project = useActiveProject();
  if (!project) return <LaunchAuditButton secondary />;
  return <ProjectFirstRunAction projectId={project.id} />;
}

function ProjectFirstRunAction({ projectId }: Readonly<{ projectId: string }>) {
  const readiness = useLaunchReadiness(projectId);
  if (readiness.kind === 'blocked') return <ActionButton action="addPrompts" href={PROMPTS_HREF} />;
  return <LaunchAuditButton secondary />;
}

function LaunchAudit({
  projectId,
  ...buttonProps
}: Readonly<LaunchRunProps & { projectId: string }>) {
  const projectHref = useProjectHref();
  const router = useNavigate();
  const [open, setOpen] = useState(false);
  const reasonId = useId();
  const readiness = useLaunchReadiness(projectId);
  const reason = readiness.kind === 'blocked' ? readiness.reason : null;
  const held = readiness.kind !== 'ready';

  const button = (
    <ActionButton
      action="launchRun"
      {...buttonProps}
      aria-disabled={held || undefined}
      aria-describedby={reason ? reasonId : undefined}
      onClick={() => {
        if (!held) setOpen(true);
      }}
    />
  );
  return (
    <>
      {reason ? (
        <>
          <Tooltip content={reason} describe={false}>
            {button}
          </Tooltip>
          <span id={reasonId} hidden>
            {reason}
          </span>
        </>
      ) : (
        button
      )}
      <LaunchDialog
        open={open}
        onOpenChange={setOpen}
        projectId={projectId}
        onLaunched={(audit) => router(projectHref(`/runs/${audit.id}`))}
      />
    </>
  );
}
