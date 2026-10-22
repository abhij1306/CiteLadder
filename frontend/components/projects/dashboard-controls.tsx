import { ChevronDown, Pencil, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from '@/components/ui/dropdown';
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
    <Dropdown>
      <DropdownTrigger asChild>
        <Button variant="secondary" className="gap-2">
          Manage project <ChevronDown className="size-3.5 opacity-80" aria-hidden />
        </Button>
      </DropdownTrigger>
      <DropdownContent align="end" className="w-56">
        {onEditProject ? (
          <DropdownItem onSelect={() => onEditProject(activeProject)}>
            <Pencil className="size-4" aria-hidden /> Edit active project
          </DropdownItem>
        ) : null}
        {mayCreate ? (
          <DropdownItem
            disabled={!canAddProject}
            onSelect={() => router(newProjectDestination(activeWorkspaceId))}
          >
            <Plus className="size-4" aria-hidden />
            <span className="min-w-0 flex-1">Add project</span>
          </DropdownItem>
        ) : null}
      </DropdownContent>
    </Dropdown>
  );
}
