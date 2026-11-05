import { ChevronDown, Pencil, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { useProjectCreation } from '@/components/layout/use-project-creation';
import type { Project } from '@/lib/api/types';
import { newProjectDestination } from '@/lib/navigation/project-destination';

export function ProjectControls({
  activeProject,
  onEditProject,
}: Readonly<{
  activeProject: Project;
  onEditProject?: (project: Project) => void;
}>) {
  const router = useNavigate();
  // A Viewer is never offered the creation affordance, matching the switcher —
  // and the backend refuses it either way.
  const { activeWorkspaceId, mayCreate, canAddProject } = useProjectCreation();
  if (!onEditProject && !mayCreate) return null;
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="secondary">
          Manage project <Icon icon={ChevronDown} className="opacity-80" />
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        {onEditProject ? (
          <MenuItem icon={<Icon icon={Pencil} />} onSelect={() => onEditProject(activeProject)}>
            Edit active project
          </MenuItem>
        ) : null}
        {mayCreate ? (
          <MenuItem
            icon={<Icon icon={Plus} />}
            disabled={!canAddProject}
            onSelect={() => router(newProjectDestination(activeWorkspaceId))}
          >
            <span className="min-w-0 flex-1 truncate">Add project</span>
          </MenuItem>
        ) : null}
      </MenuContent>
    </Menu>
  );
}
