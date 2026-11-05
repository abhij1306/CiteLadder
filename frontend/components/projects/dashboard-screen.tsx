'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type { OverviewWidget } from '@citeladder/contracts/overview';
import { ListScreen } from '@/components/layout/page-shell';
import { Callout } from '@/components/ui/callout';
import { Stack } from '@/components/ui/layout';
import { ProjectRequiredState } from '@/components/layout/project-required-state';
import { QueryState } from '@/components/ui/query-state';
import { projectQueries } from '@/lib/api/projects';
import type { CommandCenter, Project } from '@/lib/api/types';
import { useOverviewLayout } from '@/lib/overview/use-overview-layout';
import { warmOverviewWidgets } from '@/lib/overview/widget-queries';
import { useProjectContext, useWorkspaceCapability } from '@/lib/project/project-context';
import { resolveActiveProjectRequestScope } from '@/lib/project/request-scope';

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
  const scope = resolveActiveProjectRequestScope(context.activeProject);
  const commandCenter = useQuery({
    ...projectQueries.commandCenter(scope.workspaceId, scope.projectId),
    enabled: scope.enabled,
  });
  // The layout does not depend on the command center, so it is asked for
  // beside it rather than once the command center has rendered.
  const layout = useQuery({
    ...projectQueries.overviewLayout(scope.workspaceId, scope.projectId),
    enabled: scope.enabled,
  });
  useWarmWidgets(context.activeProject, layout.data?.widgets);

  if (context.isLoading || (context.activeProject && commandCenter.isLoading)) {
    return <DashboardLoading />;
  }
  if (!context.activeProject)
    return (
      <ListScreen>
        <ProjectRequiredState />
      </ListScreen>
    );
  if (commandCenter.isError || !commandCenter.data)
    return (
      <ListScreen>
        <QueryState
          kind="error"
          error={commandCenter.error}
          fallback="The command center could not be loaded."
          onRetry={() => void commandCenter.refetch()}
          pending={commandCenter.isFetching}
        />
      </ListScreen>
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

/**
 * Start the widgets' reads as soon as the layout names them, instead of when
 * they mount behind the command center. Best-effort: a widget still asks for
 * its own read and reports its own failure.
 */
function useWarmWidgets(project: Project | null, widgets: readonly OverviewWidget[] | undefined) {
  const client = useQueryClient();
  useEffect(() => {
    if (project && widgets) void warmOverviewWidgets(client, project, widgets).catch(() => {});
  }, [client, project, widgets]);
}

function DashboardLoading() {
  return (
    <ListScreen>
      <QueryState kind="loading" label="Loading your command center…" />
    </ListScreen>
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
      <ListScreen>
        <QueryState
          kind="error"
          error={layout.query.error}
          fallback="The Overview layout could not be loaded."
          onRetry={() => void layout.query.refetch()}
          pending={layout.query.isFetching}
        />
      </ListScreen>
    );
  if (!layout.query.data) return <DashboardLoading />;
  const saved = layout.query.data;
  return (
    <ListScreen
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
          <Callout tone="negative">The report could not be downloaded. Try again.</Callout>
        ) : null}
        {actions.reorderError ? (
          <Callout tone="warning">
            The shared action order changed. Review the refreshed order and try again.
          </Callout>
        ) : null}
        {layout.failed ? (
          <Callout tone="warning">
            Someone else changed this Overview. The latest layout is shown; make your change again.
          </Callout>
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
    </ListScreen>
  );
}
