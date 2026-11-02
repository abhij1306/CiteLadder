'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { httpErrorStatus } from '@/lib/api/client';
import { setReportingWorkspace } from '@/lib/client-errors';
import { projectQueries, projectsApi } from '@/lib/api/projects';
import { queryKeys } from '@/lib/api/query-keys';
import { getBootstrapReadTimeoutMs } from '@/lib/config/operational';
import {
  readStoredActiveProjectId,
  readStoredActiveWorkspaceId,
  writeStoredActiveProjectId,
  writeStoredActiveWorkspaceId,
} from '@/lib/project/active-project-storage';
import { ProjectSelectionProvider, type ProjectContextValue } from '@/lib/project/project-scope';
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

/** The scope the URL is asking for, if any. */
function useRequestedScope() {
  const searchParams = useSearchParams()[0];
  return {
    requestedProjectId: searchParams?.get('project') || null,
    urlWorkspaceId: searchParams?.get('workspace') || null,
  };
}

/** One workspace's projects, keyed by AND requested for that workspace. */
function useWorkspaceProjects(workspaceId: string | null, allowed: boolean) {
  return useQuery({
    ...projectQueries.list(workspaceId ?? 'unresolved'),
    enabled: workspaceId !== null && allowed,
  });
}

/**
 * Resolve workspace membership independently of projects. An explicit project
 * is authorized by its detail read, so a stale list cannot hide a new project.
 * Cache keys and requests carry the same workspace identity.
 */
export function ProjectProvider({ children }: Readonly<{ children: ReactNode }>) {
  const queryClient = useQueryClient();
  const { requestedProjectId, urlWorkspaceId } = useRequestedScope();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() =>
    readStoredActiveProjectId(),
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(() =>
    readStoredActiveWorkspaceId(),
  );

  // The membership authority. Needs only the session cookie, so it loads
  // alongside `me` rather than after it, and it is deliberately NOT scoped by
  // a workspace header — it is what decides which workspaces exist.
  // These are the loader's bootstrap reads; they carry its bounded timeout so
  // a stall reaches the gate's retry notice in seconds, on either creation
  // path (loader-seeded or provider-issued).
  const workspacesQuery = useQuery({
    queryKey: queryKeys.workspaces.list(),
    queryFn: ({ signal }) =>
      projectsApi.listWorkspaces({
        signal,
        workspaceId: null,
        timeoutMs: getBootstrapReadTimeoutMs(),
      }),
  });

  // The narrow resolution read for an explicit id. Authorized from the path,
  // so it answers before any workspace is known and its `workspace_id` is
  // what establishes the workspace for everything that follows.
  const detailQuery = useQuery({
    ...projectQueries.detail(requestedProjectId ?? 'none'),
    enabled: requestedProjectId !== null,
  });

  const resolvedProject = requestedProjectId === null ? null : (detailQuery.data ?? null);
  // A URL naming both a workspace and a project from a DIFFERENT workspace is
  // rejected rather than reconciled: combining one project's id with another
  // workspace's limits is how a request ends up authorized against one
  // tenancy and budgeted against another.
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
  // Include an authorized detail even if the list predates its creation.
  const projects = useMemo(() => {
    const listed = projectsQuery.data ?? [];
    // A project whose workspace contradicts the URL is rejected, not merged.
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

  const activeProject = useMemo(
    () => pickActiveProject(resolvedProject, projects, activeProjectId),
    [resolvedProject, projects, activeProjectId],
  );

  const requestedProjectMissing = isMissing(detailQuery.error);
  const failures = {
    detailFailed: detailQuery.isError && !requestedProjectMissing,
    membershipFailed: workspacesQuery.isError,
    listFailedWithNothingUsable: projectsQuery.isError && activeProject === null,
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
      // A different workspace owns a different project set, so the previous
      // workspace's selection must not survive the switch and be resolved
      // against the new list.
      setSelectedProjectId(null);
      writeStoredActiveProjectId(null);
    },
    [setSelectedProjectId, setSelectedWorkspaceId],
  );

  const retry = useCallback(() => {
    void queryClient.refetchQueries({ queryKey: queryKeys.workspaces.list() });
    void queryClient.refetchQueries({ queryKey: queryKeys.projects.all });
  }, [queryClient]);

  useEffect(() => {
    writeStoredActiveWorkspaceId(activeWorkspaceId);
    // Error reports scope themselves like every other request; the API still checks membership.
    setReportingWorkspace(activeWorkspaceId);
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (activeProjectId) writeStoredActiveProjectId(activeProjectId);
  }, [activeProjectId]);

  // Adopt the RESOLVED workspace as this session's selection.
  //
  // The address is allowed to stop naming it: `projectDestination` drops
  // `?workspace=` on the grounds that a verified project id already identifies
  // its workspace. That is true only once the project detail has answered —
  // and with the selection living nowhere but the URL, the render in between
  // fell all the way back to the FIRST membership, sending one project-list
  // request against a workspace the reader is not in and flashing the loader
  // before the detail pulled it back.
  useEffect(() => {
    // oxlint-disable-next-line react-hooks/set-state-in-effect -- mirror the resolved workspace.
    setSelectedWorkspaceId((current) =>
      activeWorkspaceId && current !== activeWorkspaceId ? activeWorkspaceId : current,
    );
  }, [activeWorkspaceId]);

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
