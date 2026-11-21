import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useCallback, useEffect } from 'react';

import { useOptionalProjectContext, useProjectContext } from '@/lib/project/project-context';
import { isAppRoute } from '@/lib/navigation/app-route';
import { projectSwitchPathname, workspaceSwitchPathname } from '@/lib/navigation/app-routes';

const PROJECT_PARAM = 'project';
const WORKSPACE_PARAM = 'workspace';
/** The single-use invitation token. Never propagated to another URL. */
const INVITATION_TOKEN_PARAM = 'token';

export function projectDestination(
  pathname: string,
  search: URLSearchParams | null,
  projectId: string,
): string {
  const params = new URLSearchParams(search?.toString() ?? '');
  params.set(PROJECT_PARAM, projectId);
  params.delete(WORKSPACE_PARAM);
  return `${pathname}?${params.toString()}`;
}

export function workspaceDestination(
  pathname: string,
  search: URLSearchParams | null,
  workspaceId: string,
): string {
  const params = new URLSearchParams(search?.toString() ?? '');
  params.set(WORKSPACE_PARAM, workspaceId);
  params.delete(PROJECT_PARAM);
  // A one-time invitation token is a credential, not a destination parameter.
  // Carrying it forward would write it into the next URL and into browser
  // history, where it long outlives the single use it was minted for.
  params.delete(INVITATION_TOKEN_PARAM);
  return `${pathname}?${params.toString()}`;
}

export function newProjectDestination(workspaceId: string | null): string {
  const params = new URLSearchParams({ new: '1' });
  return workspaceId
    ? workspaceDestination('/onboarding', params, workspaceId)
    : `/onboarding?${params.toString()}`;
}

export function scopedNavigationDestination(
  href: string,
  scope: 'project' | 'workspace',
  projectId: string | null,
  workspaceId: string | null,
): string {
  if (!isAppRoute(href)) throw new Error('Expected an internal app route');
  const hashIndex = href.indexOf('#');
  const hash = hashIndex === -1 ? '' : href.slice(hashIndex);
  const pathAndSearch = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const queryIndex = pathAndSearch.indexOf('?');
  const pathname = queryIndex === -1 ? pathAndSearch : pathAndSearch.slice(0, queryIndex);
  const search =
    queryIndex === -1 ? null : new URLSearchParams(pathAndSearch.slice(queryIndex + 1));
  if (scope === 'workspace') {
    return workspaceId ? `${workspaceDestination(pathname, search, workspaceId)}${hash}` : href;
  }
  return projectId ? `${projectDestination(pathname, search, projectId)}${hash}` : href;
}

export function useProjectHref() {
  const activeProjectId = useOptionalProjectContext()?.activeProjectId ?? null;
  return useCallback(
    (href: string, projectId: string | null = activeProjectId) =>
      scopedNavigationDestination(href, 'project', projectId, null),
    [activeProjectId],
  );
}

export function useCanonicalProjectUrl(enabled: boolean) {
  const router = useNavigate();
  const pathname = useLocation().pathname;
  const searchParams = useSearchParams()[0];
  const { activeProjectId } = useProjectContext();

  useEffect(() => {
    if (!enabled || !pathname || !activeProjectId || searchParams?.has(PROJECT_PARAM)) return;
    router(
      `${projectDestination(pathname, searchParams, activeProjectId)}${window.location.hash}`,
      {
        replace: true,
        preventScrollReset: true,
      },
    );
  }, [activeProjectId, enabled, pathname, router, searchParams]);
}

const PROJECT_NEUTRAL_PARAMS = new Set([
  'tab',
  'view',
  'range',
  'granularity',
  'compare',
  'engine',
  'status',
  'sort',
  'section',
  'severity',
  'category',
  'rule',
  'page_kind',
]);

function projectSwitchParams(search: URLSearchParams | null): URLSearchParams {
  const kept = new URLSearchParams();
  for (const [key, value] of search ?? []) {
    if (PROJECT_NEUTRAL_PARAMS.has(key)) kept.append(key, value);
  }
  return kept;
}

export type SelectProjectOptions = {
  destination?: string;
  replace?: boolean;
};

export function useSelectProject() {
  const router = useNavigate();
  const pathname = useLocation().pathname;
  const searchParams = useSearchParams()[0];
  const { activeProjectId, setActiveProjectId } = useProjectContext();

  return useCallback(
    (projectId: string, options: SelectProjectOptions = {}) => {
      const { destination, replace = false } = options;
      setActiveProjectId(projectId);
      const switching = projectId !== activeProjectId;
      const landing = destination ?? (switching ? projectSwitchPathname(pathname) : pathname);
      const target = projectDestination(
        landing,
        switching ? projectSwitchParams(searchParams) : searchParams,
        projectId,
      );
      const urlAlreadyNamesIt = searchParams?.get(PROJECT_PARAM) === projectId;
      const samePage = landing === pathname;
      if (urlAlreadyNamesIt && samePage && !replace) return;
      if (replace || (samePage && projectId === activeProjectId)) {
        router(target, { replace: true, preventScrollReset: true });
      } else {
        router(target);
      }
    },
    [activeProjectId, pathname, router, searchParams, setActiveProjectId],
  );
}

/**
 * The one way the shell changes its WORKSPACE selection.
 *
 * Selecting a workspace is an explicit act, never inferred from a project, so
 * this is deliberately separate from `useSelectProject`. The destination names
 * the workspace and drops any project parameter: the previous workspace's
 * project does not exist in the new one, and carrying it over would produce
 * exactly the contradictory pair the provider has to reject.
 *
 * A deliberate switch to a DIFFERENT workspace pushes one history entry;
 * selecting the one already active does nothing.
 */
export function useSelectWorkspace() {
  const router = useNavigate();
  const pathname = useLocation().pathname;
  const searchParams = useSearchParams()[0];
  const { activeWorkspaceId, setActiveWorkspaceId } = useProjectContext();

  return useCallback(
    (workspaceId: string, destination?: string) => {
      const switching = workspaceId !== activeWorkspaceId;
      if (!switching && (destination === undefined || destination === pathname)) return;
      setActiveWorkspaceId(workspaceId);
      const landing = destination ?? (switching ? workspaceSwitchPathname(pathname) : pathname);
      const params =
        destination === undefined && switching ? projectSwitchParams(searchParams) : searchParams;
      router(workspaceDestination(landing, params, workspaceId));
    },
    [activeWorkspaceId, pathname, router, searchParams, setActiveWorkspaceId],
  );
}
