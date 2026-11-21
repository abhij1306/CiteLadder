import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { MastheadPrimary } from '@/components/ui/masthead-actions';
import { ReportPage } from '@/components/templates/report-page';
import type { Project } from '@citeladder/contracts';
import { useProjectCreation } from '@/components/layout/use-project-creation';
import { FolderOpen, Plus } from '@/lib/icons';
import { useProjectContext } from '@/lib/project/project-context';
import { finishOnboardingNavigationHandoff } from '@/lib/onboarding/timing';
import { newProjectDestination } from '@/lib/navigation/project-destination';

import { ProjectEditPanel } from './project-edit-panel';
import { DashboardScreen } from './dashboard-screen';
import { OverviewLoading } from './overview-loading';
import { StateBlock } from '@/components/ui/state-block';

export function ProjectsScreen() {
  const { projects, projectsSettled, activeProject, status } = useProjectContext();
  const searchParams = useSearchParams()[0];
  const requestedProjectId = searchParams?.get('project') ?? null;
  const [editing, setEditing] = useState<Project | null>(null);
  const navigate = useNavigate();
  const { activeWorkspaceId, canAddProject, mayCreate } = useProjectCreation();

  useEffect(() => {
    if (requestedProjectId && status === 'ready' && activeProject?.id === requestedProjectId) {
      finishOnboardingNavigationHandoff(requestedProjectId);
    }
  }, [activeProject?.id, requestedProjectId, status]);

  if (projects.length === 0 && !projectsSettled) {
    return (
      <ReportPage>
        <OverviewLoading />
      </ReportPage>
    );
  }
  if (projects.length === 0) {
    return (
      <ReportPage
        actions={
          mayCreate ? (
            <MastheadPrimary>
              <Button
                variant="primary"
                disabled={!canAddProject}
                onClick={() => navigate(newProjectDestination(activeWorkspaceId))}
              >
                <Icon icon={Plus} />
                Add project
              </Button>
            </MastheadPrimary>
          ) : undefined
        }
      >
        <StateBlock kind="empty" icon={FolderOpen} heading="No projects yet" />
      </ReportPage>
    );
  }

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
