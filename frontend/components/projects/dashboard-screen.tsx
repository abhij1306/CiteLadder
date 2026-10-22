'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { PageShell } from '@/components/layout/page-shell';
import { Alert } from '@/components/ui/alert';
import { Stack } from '@/components/ui/layout';
import { ProjectRequiredState } from '@/components/layout/project-required-state';
import { QueryState } from '@/components/ui/query-state';
import { projectsApi } from '@/lib/api/projects';
import { queryKeys } from '@/lib/api/query-keys';
import type { CommandCenter, Project } from '@/lib/api/types';
import { useOverviewLayout } from '@/lib/overview/use-overview-layout';
import { useProjectContext, useWorkspaceCapability } from '@/lib/project/project-context';

import { DashboardActions, DashboardHeader } from './dashboard-sections';
import { OverviewGrid } from './overview-grid';
import { OverviewLayoutMenu } from './overview-layout-menu';
import { OverviewWidgetView } from './overview-widget';
import { PromptSetupCard } from './prompt-setup-card';
import { useCommandCenterActions } from './use-command-center-actions';

export function DashboardScreen({
  onEditProject,
}: Readonly<{ onEditProject?: (project: Project) => void }> = {}) {
  const context = useProjectContext();
  const commandCenter = useQuery({
    queryKey: queryKeys.projects.commandCenter(context.activeProject?.id ?? ''),
    queryFn: ({ signal }) =>
      projectsApi.getCommandCenter(context.activeProject!.id, {
        signal,
        workspaceId: context.activeProject!.workspace_id,
      }),
    enabled: Boolean(context.activeProject),
  });

  if (context.isLoading || (context.activeProject && commandCenter.isLoading)) {
    return <DashboardLoading />;
  }
  if (!context.activeProject)
    return (
      <PageShell>
        <ProjectRequiredState />
      </PageShell>
    );
  if (commandCenter.isError || !commandCenter.data)
    return (
      <PageShell>
        <QueryState
          kind="error"
          error={commandCenter.error}
          fallback="The command center could not be loaded."
          onRetry={() => void commandCenter.refetch()}
          pending={commandCenter.isFetching}
        />
      </PageShell>
    );

  return (
    <DashboardData
      key={context.activeProject.id}
      data={commandCenter.data}
      activeProject={context.activeProject}
      onEditProject={onEditProject}
    />
  );
}

function DashboardLoading() {
  return (
    <PageShell>
      <QueryState kind="loading" label="Loading your command center…" />
    </PageShell>
  );
}

function DashboardData({
  data,
  activeProject,
  onEditProject,
}: Readonly<{
  data: CommandCenter;
  activeProject: Project;
  onEditProject?: (project: Project) => void;
}>) {
  const actions = useCommandCenterActions(data, activeProject);
  const layout = useOverviewLayout(activeProject);
  const canEdit = useWorkspaceCapability('write');
  const [editing, setEditing] = useState(false);
  if (layout.query.isError)
    return (
      <PageShell>
        <QueryState
          kind="error"
          error={layout.query.error}
          fallback="The Overview layout could not be loaded."
          onRetry={() => void layout.query.refetch()}
          pending={layout.query.isFetching}
        />
      </PageShell>
    );
  if (!layout.query.data) return <DashboardLoading />;
  const saved = layout.query.data;
  return (
    <PageShell
      actions={
        <DashboardActions
          activeProject={activeProject}
          onEditProject={onEditProject}
          downloading={actions.downloading}
          onDownload={actions.download}
          layoutMenu={
            canEdit ? (
              <OverviewLayoutMenu
                layout={saved}
                editing={editing}
                pending={layout.pending}
                onEditingChange={setEditing}
                onSave={layout.save}
              />
            ) : null
          }
        />
      }
    >
      <Stack gap="workspace">
        <DashboardHeader data={data} activeProject={activeProject} />
        {data.active_prompt_count === 0 ? <PromptSetupCard /> : null}
        {actions.downloadError ? (
          <Alert tone="danger">The report could not be downloaded. Try again.</Alert>
        ) : null}
        {actions.reorderError ? (
          <Alert tone="warning">
            The shared action order changed. Review the refreshed order and try again.
          </Alert>
        ) : null}
        {layout.failed ? (
          <Alert tone="warning">
            Someone else changed this Overview. The latest layout is shown; make your change again.
          </Alert>
        ) : null}
        <OverviewGrid
          widgets={saved.widgets}
          editing={canEdit && editing}
          pending={layout.pending}
          onChange={layout.save}
          render={(widget) => (
            <OverviewWidgetView
              widgetKey={widget.key}
              data={data}
              project={activeProject}
              actions={actions}
            />
          )}
        />
      </Stack>
    </PageShell>
  );
}
