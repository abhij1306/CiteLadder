import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { httpErrorStatus } from '@/lib/api/client';
import { setReportingWorkspace } from '@/lib/client-errors';
import { projectQueries, retryProjectShell } from '@/lib/api/projects';
import { workspaceQueries } from '@/lib/api/workspaces';
import {
  readStoredActiveProjectId,
  readStoredActiveWorkspaceId,
  writeStoredActiveProjectId,
  writeStoredActiveWorkspaceId,
} from '@/lib/project/active-project-storage';
import { ProjectSelectionProvider, type ProjectContextValue } from '@/lib/project/project-scope';
import type { Project, ProjectSummary } from '@citeladder/contracts';
import {
  pickActiveProject,
  resolveFailed,
  resolveFailureScope,
  resolveProjectId,
  resolveStatus,
  resolveWorkspaceId,
} from '@/lib/project/selection';

export {
  useActiveProject,
  useActiveWorkspaceId,
  useOptionalProjectContext,
  useProjectContext,
  useWorkspaceCapability,
  type ProjectContextValue,
} from '@/lib/project/project-scope';

const isMissing = (error: unknown) => httpErrorStatus(error) === 404;

function useRequestedScope() {
  const searchParams = useSearchParams()[0];
  return {
    requestedProjectId: searchParams?.get('project') || null,
    urlWorkspaceId: searchParams?.get('workspace') || null,
  };
}

function useWorkspaceProjects(workspaceId: string | null, allowed: boolean) {
  return useQuery({
    ...projectQueries.list(workspaceId ?? 'unresolved'),
    enabled: workspaceId !== null && allowed,
  });
}

function useActiveProjectView({
  activeProjectId,
  activeWorkspaceId,
  resolvedProject,
  explicit,
  listSettled,
  listFailed,
  allowed,
}: Readonly<{
  activeProjectId: string | null;
  activeWorkspaceId: string | null;
  resolvedProject: Project | null;
  explicit: boolean;
  listSettled: boolean;
  listFailed: boolean;
  allowed: boolean;
}>) {
  const viewQuery = useQuery({
    ...projectQueries.detail(activeProjectId ?? 'none'),
    enabled: activeProjectId !== null && allowed,
  });
  const activeProject = useMemo(
    () => pickActiveProject([resolvedProject, viewQuery.data], activeProjectId, activeWorkspaceId),
    [resolvedProject, viewQuery.data, activeProjectId, activeWorkspaceId],
  );
  const viewFailed = viewQuery.isError && listSettled && !explicit;
  return {
    activeProject,
    failedWithNothingUsable:
      (listFailed && (activeProject === null || !explicit)) ||
      (activeProject === null && viewFailed),
  };
}

function adoptWorkspace(resolved: string | null, selected: string | null) {
  return resolved ?? selected;
}

export function ProjectProvider({ children }: Readonly<{ children: ReactNode }>) {
  const queryClient = useQueryClient();
  const { requestedProjectId, urlWorkspaceId } = useRequestedScope();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() =>
    readStoredActiveProjectId(),
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(() =>
    readStoredActiveWorkspaceId(),
  );

  const workspacesQuery = useQuery(workspaceQueries.list());

  const detailQuery = useQuery({
    ...projectQueries.detail(requestedProjectId ?? 'none'),
    enabled: requestedProjectId !== null,
  });

  const resolvedProject = requestedProjectId === null ? null : (detailQuery.data ?? null);
  const contradictoryRequest = Boolean(
    urlWorkspaceId && resolvedProject && resolvedProject.workspace_id !== urlWorkspaceId,
  );

  const workspaces = workspacesQuery.data;
  const activeWorkspaceId = useMemo(
    () =>
      resolveWorkspaceId({
        projectWorkspaceId: resolvedProject?.workspace_id ?? null,
        urlWorkspaceId,
        selectedWorkspaceId,
        workspaces,
      }),
    [resolvedProject, urlWorkspaceId, selectedWorkspaceId, workspaces],
  );

  const projectsQuery = useWorkspaceProjects(activeWorkspaceId, !contradictoryRequest);
  const listSettled = projectsQuery.isSuccess;
  const projects = useMemo<ProjectSummary[]>(() => {
    const listed = projectsQuery.data ?? [];
    if (!resolvedProject || contradictoryRequest) return listed;
    if (listed.some((project) => project.id === resolvedProject.id)) return listed;
    return [...listed, resolvedProject];
  }, [contradictoryRequest, projectsQuery.data, resolvedProject]);

  const activeProjectId = useMemo(
    () =>
      resolveProjectId({
        requestedProjectId,
        selectedProjectId,
        projects,
        listSettled,
      }),
    [requestedProjectId, selectedProjectId, projects, listSettled],
  );

  const { activeProject, failedWithNothingUsable } = useActiveProjectView({
    activeProjectId,
    activeWorkspaceId,
    resolvedProject,
    explicit: requestedProjectId !== null,
    listSettled,
    listFailed: projectsQuery.isError,
    allowed: !contradictoryRequest,
  });

  const requestedProjectMissing = isMissing(detailQuery.error);
  const failures = {
    detailFailed: detailQuery.isError && !requestedProjectMissing,
    membershipFailed: workspacesQuery.isError,
    listFailedWithNothingUsable: failedWithNothingUsable,
  };
  const failed = resolveFailed(failures);
  const errorScope = failed ? resolveFailureScope(failures) : null;

  const status = resolveStatus({
    contradictoryRequest,
    requestedProjectPending:
      requestedProjectId !== null && activeProject === null && !requestedProjectMissing,
    requestedProjectMissing,
    failed,
    noWorkspace: workspacesQuery.isSuccess && workspacesQuery.data.length === 0,
    workspaceId: activeWorkspaceId,
    activeProjectId,
    hasResolvedProject: activeProject !== null,
    listSettled,
  });

  const setActiveProjectId = useCallback(
    (projectId: string) => {
      setSelectedProjectId(projectId);
      writeStoredActiveProjectId(projectId);
    },
    [setSelectedProjectId],
  );

  const selectWorkspace = useCallback(
    (workspaceId: string) => {
      setSelectedWorkspaceId(workspaceId);
      writeStoredActiveWorkspaceId(workspaceId);
      setSelectedProjectId(null);
      writeStoredActiveProjectId(null);
    },
    [setSelectedProjectId, setSelectedWorkspaceId],
  );

  const retry = useCallback(() => void retryProjectShell(queryClient), [queryClient]);

  useEffect(() => {
    writeStoredActiveWorkspaceId(activeWorkspaceId);
    setReportingWorkspace(activeWorkspaceId);
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (activeProjectId) writeStoredActiveProjectId(activeProjectId);
  }, [activeProjectId]);

  const adoptedWorkspaceId = adoptWorkspace(activeWorkspaceId, selectedWorkspaceId);
  if (adoptedWorkspaceId !== selectedWorkspaceId) setSelectedWorkspaceId(adoptedWorkspaceId);

  const value = useMemo<ProjectContextValue>(
    () => ({
      workspaces: workspaces ?? [],
      activeWorkspaceId,
      activeWorkspace: workspaces?.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
      setActiveWorkspaceId: selectWorkspace,
      projects,
      projectsSettled: listSettled,
      activeProject,
      activeProjectId,
      setActiveProjectId,
      status,
      errorScope,
      retry,
      isLoading: status === 'resolving',
      isError: status === 'error',
    }),
    [
      workspaces,
      activeWorkspaceId,
      selectWorkspace,
      projects,
      listSettled,
      activeProject,
      activeProjectId,
      setActiveProjectId,
      status,
      errorScope,
      retry,
    ],
  );

  return <ProjectSelectionProvider value={value}>{children}</ProjectSelectionProvider>;
}
