'use client';

import { Rocket } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';

import { Button, type ButtonProps } from '@/components/ui/button';
import { useProjectHref } from '@/lib/navigation/project-destination';
import { useActiveProject } from '@/lib/project/project-context';

import { LaunchDialog } from './launch-dialog';

/** Opens the shared audit configuration dialog and routes directly to the new run. */
export function LaunchAuditButton({
  children = 'Launch audit',
  showIcon = true,
  ...buttonProps
}: Readonly<ButtonProps & { showIcon?: boolean }>) {
  const project = useActiveProject();
  const projectHref = useProjectHref();
  const router = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        {...buttonProps}
        disabled={!project || buttonProps.disabled}
        onClick={() => setOpen(true)}
      >
        {showIcon ? <Rocket className="size-4" aria-hidden /> : null}
        {children}
      </Button>
      {project ? (
        <LaunchDialog
          open={open}
          onOpenChange={setOpen}
          projectId={project.id}
          onLaunched={(audit) => router(projectHref(`/runs/${audit.id}`))}
        />
      ) : null}
    </>
  );
}
