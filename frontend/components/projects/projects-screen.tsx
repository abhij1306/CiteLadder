'use client';

import { FolderOpen, Plus } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { QueryState } from '@/components/ui/query-state';
import { ListScreen } from '@/components/layout/page-shell';
import type { Project } from '@/lib/api/types';
import { useProjectCreation } from '@/components/layout/use-project-creation';
import { useProjectContext } from '@/lib/project/project-context';
import { finishOnboardingNavigationHandoff } from '@/lib/onboarding/timing';
import { newProjectDestination } from '@/lib/navigation/project-destination';

import { ProjectEditPanel } from './project-edit-panel';
import { DashboardScreen } from './dashboard-screen';

/**
 * `/projects` — manage every project in the workspace.
 *
 * Built for agencies and multi-brand teams, who are the users with more than
 * one: the project switcher in the sidebar is fine for hopping between two, but
 * not for seeing what you have. This takes the sidebar slot the retired "Setup"
 * item left behind, and owns the "add another project" entry point that
 * `/setup/new` used to.
 *
 * Creating goes through `/onboarding?new=1` — the same discovery flow as the
 * first project, because a second brand needs its competitors and prompts found
 * just as much as the first did.
 */
export function ProjectsScreen() {
  const { projects, projectsSettled, activeProject, status } = useProjectContext();
  const searchParams = useSearchParams()[0];
  const requestedProjectId = searchParams?.get('project') ?? null;
  const [editing, setEditing] = useState<Project | null>(null);
  const navigate = useNavigate();
  // Write access edits and adds projects; a Viewer is offered neither.
  const { activeWorkspaceId, canAddProject, mayCreate } = useProjectCreation();

  // The source mark carries the committed UUID. Close it after this route has
  // committed with that same authorized project, never for a fallback project.
  useEffect(() => {
    if (requestedProjectId && status === 'ready' && activeProject?.id === requestedProjectId) {
      finishOnboardingNavigationHandoff(requestedProjectId);
    }
  }, [activeProject?.id, requestedProjectId, status]);

  // "No projects yet" is a CLAIM about the workspace, so it needs a settled
  // answer. The gate does not supply one: its `ready` state is reached by a
  // directly-resolved project alone, deliberately, so a brand-new project is
  // usable before the list reconciles — and the list is `[]` while it loads.
  // Reading that as "no projects" is what showed this empty state to someone
  // who had just created their first project, until they refreshed.
  if (projects.length === 0 && !projectsSettled) {
    return (
      <ListScreen>
        <QueryState kind="loading" label="Loading your projects…" />
      </ListScreen>
    );
  }
  if (projects.length === 0) {
    return (
      <ListScreen>
        <QueryState
          kind="empty"
          icon={FolderOpen}
          heading="No projects yet"
          description={
            mayCreate
              ? 'Add a brand to start tracking how AI answers describe it.'
              : 'Ask the workspace owner or an admin to add a project.'
          }
          action={
            mayCreate ? (
              <Button
                disabled={!canAddProject}
                onClick={() => navigate(newProjectDestination(activeWorkspaceId))}
              >
                <Icon icon={Plus} />
                Add project
              </Button>
            ) : undefined
          }
        />
      </ListScreen>
    );
  }

  // A fragment: the dashboard is a ListScreen whose bands must meet flush, and
  // the edit panel is an overlay, so there is no rhythm here to own.
  return (
    <>
      <DashboardScreen onEditProject={mayCreate ? (project) => setEditing(project) : undefined} />

      {editing ? (
        <ProjectEditPanel
          key={editing.id}
          project={editing}
          open
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}
