/**
 * Resolve the application shell BEFORE anything mounts.
 *
 * The decision this makes — send an empty workspace to project creation, or
 * put the project back in the address — used to live in two `useEffect`s. An
 * effect cannot run until a render has already committed, so a cold load on an
 * account with no projects painted the bare shell, then the full application
 * chrome, then a loader, then another loader, and only then onboarding. The
 * sidebar and project switcher appeared and were thrown away for a flow that
 * has neither.
 *
 * A route loader runs before the route element renders at all, so the same
 * decision costs one paint instead of four. React Router shows the route's
 * `hydrateFallbackElement` while this runs.
 *
 * Everything it warms lands in the query cache under the keys the providers
 * below already read, so nothing downstream changes shape — the providers just
 * find their answers already there. A reload of an address the device
 * recognises asks for the local user, the workspace's projects, the shell's
 * reads and the screen's in one round; only reads that need another read's answer
 * wait for it.
 */
import type { Query, QueryClient } from '@tanstack/react-query';
import { redirect } from 'react-router-dom';

import { authQueries } from '@/lib/api/auth';
import { projectQueries } from '@/lib/api/projects';
import { workspaceQueries } from '@/lib/api/workspaces';
import { getAppQueryClient } from '@/lib/api/query-client';
import { queryKeys } from '@/lib/api/query-keys';
import type { Project, ProjectSummary, Workspace } from '@citeladder/contracts';
import { projectDestination, workspaceDestination } from '@/lib/navigation/project-destination';
import {
  prefetchProjectShell,
  prefetchRoute,
  type ProjectScope,
} from '@/lib/navigation/route-prefetch';
import { isWorkspaceOnlyRoute } from '@/lib/navigation/app-routes';
import {
  readStoredActiveProjectId,
  readStoredActiveWorkspaceId,
} from '@/lib/project/active-project-storage';
import { resolveGate } from '@/lib/project/bootstrap';
import { resolveProjectId, resolveStatus, resolveWorkspaceId } from '@/lib/project/selection';

/**
 * Ask for something the decision needs, and treat any failure as "unknown".
 *
 * A read that fails must not become a redirect or an error boundary: the gate
 * below still renders, and it owns the retry notices that distinguish a failed
 * workspace read from a failed project read. Throwing here would replace
 * those with a generic route error and lose the distinction entirely.
 */
async function settle<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch {
    return null;
  }
}

/**
 * Warm the local user's profile. A failure is a transport problem, and
 * `SessionGuard` reports it with a retry, so the loader steps aside.
 */
async function loadLocalUser(client: QueryClient): Promise<boolean> {
  try {
    await client.ensureQueryData(authQueries.me());
    return true;
  } catch {
    return false;
  }
}

type Scope = {
  workspaceId: string;
  workspaces: Workspace[];
  resolvedProject: Project | null;
  requestedProjectId: string | null;
};

type Guess = Readonly<{
  workspaceId: string;
  project: Readonly<{ id: string; issued: Promise<unknown> }> | null;
}>;

const WARM_KEYS = new Set(['project', 'workspace', 'tab']);

/**
 * Start a project's reads: the landing screen's and the shell's own.
 *
 * Cache warms under each consumer's own query key, never a render: the
 * session gate still decides whether anything mounts, and the backend
 * authorizes every read. The screen is warmed only for an address
 * naming nothing but its scope — the prefetchers warm each screen's default
 * view, and filters in the address ask for a different key.
 */
function warmProject(client: QueryClient, url: URL, scope: ProjectScope) {
  const scopeOnly = [...url.searchParams.keys()].every((key) => WARM_KEYS.has(key));
  return Promise.all([
    prefetchProjectShell(client, scope),
    scopeOnly ? prefetchRoute(client, url.pathname + url.search, scope) : null,
  ]);
}

/**
 * Start, beside `me`, every read the address lets the loader predict.
 *
 * A returning reader's workspace is the one the address names or the device
 * remembers, and their project the one the address names or the device
 * remembers. Waiting for the membership list to confirm either before asking
 * for the workspace's projects and the screen's reads cost a full round trip per
 * wait on every hard refresh, though none of those reads needs the list's
 * answer: the backend authorizes each one, and the gates still decide what
 * renders. A guess the loader later finds wrong is withdrawn by `settleGuess`.
 */
function guessScope(client: QueryClient, url: URL): Guess | null {
  const urlWorkspaceId = url.searchParams.get('workspace') || null;
  const workspaceId = urlWorkspaceId ?? readStoredActiveWorkspaceId();
  if (!workspaceId) return null;
  void client.prefetchQuery(projectQueries.list(workspaceId));
  const projectId =
    url.searchParams.get('project') || (urlWorkspaceId ? null : readStoredActiveProjectId());
  if (!projectId || isWorkspaceOnlyRoute(url.pathname)) return { workspaceId, project: null };
  void client.prefetchQuery(projectQueries.detail(projectId));
  const issued = warmProject(client, url, { projectId, workspaceId });
  return { workspaceId, project: { id: projectId, issued } };
}

function unansweredProjectRead(projectId: string) {
  return (query: Query) =>
    query.state.data === undefined &&
    query.queryKey.includes(projectId) &&
    !queryKeys.projects.isDetail(query.queryKey);
}

async function settleGuess(client: QueryClient, guess: Guess | null, actual: ProjectScope | null) {
  if (!guess?.project) return;
  const { id, issued } = guess.project;
  if (actual?.projectId === id && actual.workspaceId === guess.workspaceId) return;
  await issued;
  const predicate = unansweredProjectRead(id);
  await client.cancelQueries({ predicate });
  client.removeQueries({ predicate });
}

function settleSelectedGuess(
  client: QueryClient,
  guess: Guess | null,
  { requestedProjectId, workspaceId }: Scope,
  activeProjectId: string | null,
) {
  if (requestedProjectId) return Promise.resolve();
  return settleGuess(
    client,
    guess,
    activeProjectId ? { projectId: activeProjectId, workspaceId } : null,
  );
}

async function requestedProject(
  client: QueryClient,
  url: URL,
  {
    projectId,
    urlWorkspaceId,
    guess,
  }: Readonly<{
    projectId: string;
    urlWorkspaceId: string | null;
    guess: Guess | null;
  }>,
): Promise<Project | null> {
  const project = await settle(client.ensureQueryData(projectQueries.detail(projectId)));
  const scope =
    project && (!urlWorkspaceId || project.workspace_id === urlWorkspaceId)
      ? { projectId: project.id, workspaceId: project.workspace_id }
      : null;
  await settleGuess(client, guess, scope);
  if (scope) void warmProject(client, url, scope);
  return project;
}

async function resolveScope(
  client: QueryClient,
  url: URL,
  guess: Guess | null,
): Promise<Scope | null> {
  const requestedProjectId = url.searchParams.get('project') || null;
  const urlWorkspaceId = url.searchParams.get('workspace') || null;

  const workspacesPending = settle(client.ensureQueryData(workspaceQueries.list()));
  const projectPending = requestedProjectId
    ? requestedProject(client, url, { projectId: requestedProjectId, urlWorkspaceId, guess })
    : null;
  const workspaces = await workspacesPending;
  if (!workspaces) return null;
  const resolvedProject = await projectPending;

  if (urlWorkspaceId && resolvedProject && resolvedProject.workspace_id !== urlWorkspaceId) {
    return null;
  }

  const workspaceId = resolveWorkspaceId({
    projectWorkspaceId: resolvedProject?.workspace_id ?? null,
    urlWorkspaceId,
    selectedWorkspaceId: readStoredActiveWorkspaceId(),
    workspaces,
  });
  if (!workspaceId) return null;

  return { workspaceId, workspaces, resolvedProject, requestedProjectId };
}

/** The workspace's projects, or joined where the guess already asked for them. */
function readProjects(client: QueryClient, workspaceId: string) {
  return settle<ProjectSummary[]>(client.ensureQueryData(projectQueries.list(workspaceId)));
}

function resolveSelection(scope: Scope, listed: ProjectSummary[]) {
  const { workspaceId, resolvedProject, requestedProjectId } = scope;
  const known = listed.some((project) => project.id === resolvedProject?.id);
  const projects: ProjectSummary[] =
    resolvedProject && !known ? [...listed, resolvedProject] : listed;
  const activeProjectId = resolveProjectId({
    requestedProjectId,
    selectedProjectId: readStoredActiveProjectId(),
    projects,
    listSettled: true,
  });
  const status = resolveStatus({
    contradictoryRequest: false,
    requestedProjectPending: false,
    requestedProjectMissing: requestedProjectId !== null && resolvedProject === null,
    failed: false,
    noWorkspace: false,
    workspaceId,
    activeProjectId,
    hasResolvedProject: projects.some((project) => project.id === activeProjectId),
    listSettled: true,
  });
  return { activeProjectId, status };
}

export async function bootstrapPrivateRoutes({ request }: { request: Request }) {
  const client = getAppQueryClient();
  const url = new URL(request.url);

  // `me` and the membership list are independent — the tree's own providers
  // already issue them in parallel, and the loader pays for every round trip
  // it serializes. The guessed workspace's projects and the guessed project's
  // reads go out in the same round.
  const guess = guessScope(client, url);
  const [userResolved, scope] = await Promise.all([
    loadLocalUser(client),
    resolveScope(client, url, guess),
  ]);
  if (!userResolved || !scope) return null;

  const { workspaceId, workspaces, requestedProjectId } = scope;
  const listed = await readProjects(client, workspaceId);
  if (!listed) return null;

  const { activeProjectId, status } = resolveSelection(scope, listed);
  await settleSelectedGuess(client, guess, scope, activeProjectId);
  const projectRequired = !isWorkspaceOnlyRoute(url.pathname);
  const decision = resolveGate(status, {
    projectRequired,
    mayCreate: workspaces.some(
      (workspace) => workspace.id === workspaceId && workspace.capabilities.includes('write'),
    ),
  });

  // Only a workspace whose list came back successfully EMPTY, with creation
  // permitted by role, is sent to project creation. Every other state —
  // a failed read or a project that is merely missing —
  // falls through and is answered by `OnboardingGate`, which owns those
  // notices and their retries.
  if (decision === 'redirecting') {
    throw redirect(workspaceDestination('/onboarding', null, workspaceId));
  }

  if (decision === 'ready' && projectRequired && activeProjectId && !requestedProjectId) {
    void client.prefetchQuery(projectQueries.detail(activeProjectId));
    void warmProject(client, url, { projectId: activeProjectId, workspaceId });
    throw redirect(
      `${projectDestination(url.pathname, url.searchParams, activeProjectId)}${url.hash}`,
    );
  }

  return null;
}
