import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { SidebarIdentButton, SidebarTextTooltip } from '@/components/ui/sidebar';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import { BrandMark } from '@/components/ui/brand-mark';
import { Building2, Plus } from '@/lib/icons';
import { projectQueries } from '@/lib/api/projects';
import {
  newProjectDestination,
  useSelectProject,
  useSelectWorkspace,
} from '@/lib/navigation/project-destination';
import { useProjectContext } from '@/lib/project/project-context';

import { useProjectCreation } from '@/components/layout/use-project-creation';

/**
 * ProjectSwitcher — brand avatar + active project name with a dropdown of
 * the workspaces the reader can select and the projects inside the active one.
 *
 * Selection goes through the shared navigation owners so the context, the
 * device storage and the URL cannot disagree: the destination NAMES the
 * chosen project, which is what the arriving context resolves against. An
 * additional project carries its target workspace for the same reason — a
 * refresh of the creation route must not re-target it.
 *
 * A workspace is selectable INDEPENDENTLY of its projects: an
 * empty workspace appears here like any other and stays manageable, because
 * choosing one is an explicit act rather than something inferred from a
 * project. The workspace section is shown only when there is more than one to
 * choose between, so the ordinary single-workspace account sees exactly the
 * switcher it saw before.
 */
export function ProjectSwitcher() {
  const router = useNavigate();
  const queryClient = useQueryClient();
  const selectProject = useSelectProject();
  const selectWorkspace = useSelectWorkspace();
  const {
    workspaces,
    activeWorkspace,
    projects,
    activeProject,
    activeProjectId,
    activeWorkspaceId,
    isLoading,
  } = useProjectContext();
  const { mayCreate, canAddProject } = useProjectCreation();

  const label = activeProject?.brand_name || activeProject?.name || 'No project';

  return (
    <Menu>
      <SidebarTextTooltip inRail>
        <MenuTrigger asChild disabled={isLoading}>
          <SidebarIdentButton
            aria-label={label}
            title={label}
            pending={isLoading}
            lead={
              isLoading ? (
                <span aria-hidden className="bg-well rounded-mark size-5 shrink-0" />
              ) : (
                <BrandMark
                  name={label}
                  logoUrl={activeProject?.brand.logo_url}
                  websiteUrl={activeProject?.website_url}
                />
              )
            }
          />
        </MenuTrigger>
      </SidebarTextTooltip>
      <MenuContent align="start">
        {workspaces.length > 1 ? (
          <>
            <MenuLabel>Workspaces</MenuLabel>
            <MenuSeparator />
            {workspaces.map((workspace) => {
              const selected = workspace.id === activeWorkspaceId;
              return (
                <MenuItem
                  key={workspace.id}
                  data-active={selected}
                  onSelect={() => selectWorkspace(workspace.id)}
                  icon={<Building2 aria-hidden />}
                  selected={selected}
                >
                  {workspace.name}
                </MenuItem>
              );
            })}
            <MenuSeparator />
          </>
        ) : null}
        <MenuLabel>Projects</MenuLabel>
        <MenuSeparator />
        {projects.length === 0 ? (
          <MenuItem disabled>
            <span className="text-ink-2 min-w-0 flex-1 truncate">
              No projects in {activeWorkspace?.name ?? 'this workspace'}
            </span>
          </MenuItem>
        ) : null}
        {projects.map((project) => {
          const selected = project.id === activeProjectId;
          return (
            <MenuItem
              key={project.id}
              data-active={selected}
              onFocus={() => {
                if (!selected) void queryClient.prefetchQuery(projectQueries.detail(project.id));
              }}
              onSelect={() => selectProject(project.id)}
              icon={
                <BrandMark
                  name={project.brand_name || project.name}
                  logoUrl={project.brand.logo_url}
                  websiteUrl={project.website_url}
                  placement="inline"
                />
              }
              selected={selected}
            >
              {project.brand_name || project.name}
            </MenuItem>
          );
        })}
        {mayCreate ? (
          <>
            <MenuSeparator />
            <MenuItem
              icon={<Plus aria-hidden />}
              disabled={!canAddProject}
              onSelect={() => router(newProjectDestination(activeWorkspaceId))}
            >
              <span className="min-w-0 flex-1 truncate">New project</span>
            </MenuItem>
          </>
        ) : null}
      </MenuContent>
    </Menu>
  );
}
