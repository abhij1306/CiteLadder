import type { Project, Workspace } from '@/lib/api/types';

/**
 * Pure selection algebra for the authenticated shell.
 *
 * Kept apart from the provider so the precedence rules can be read — and
 * tested — without a React tree, a QueryClient or a router. Every function
 * here is total: it answers from whatever is known so far and never needs a
 * "not yet" branch in the caller.
 */

/** How far the shell has got towards knowing what it is showing. */
export type SelectionStatus =
  /** Still resolving. No fallback project, no redirect, no empty state. */
  | 'resolving'
  /** A project is resolved and usable. */
  | 'ready'
  /** The workspace is known and genuinely has no projects. */
  | 'empty'
  /** The requested project is missing, unauthorized, or contradicts the URL. */
  | 'unavailable'
  /** A read failed. Recoverable — the reader can retry. */
  | 'error'
  /** The person belongs to no workspace yet; onboarding creates their own. */
  | 'no_workspace';

export type WorkspaceInputs = {
  /** The workspace of an explicitly requested, already-authorized project. */
  projectWorkspaceId: string | null;
  /** An explicit `?workspace=` on a workspace-only route. */
  urlWorkspaceId: string | null;
  /** This session's deliberate choice, seeded from device storage. */
  selectedWorkspaceId: string | null;
  /** The membership authority, or `undefined` while it loads. */
  workspaces: readonly Workspace[] | undefined;
};

/**
 * Resolve which workspace the shell is in.
 *
 * Precedence: an authorized project decides its own workspace; then an
 * explicit URL workspace; then this session's selection; then the first
 * membership. A candidate that the loaded membership list does not contain is
 * discarded — storage and URLs are conveniences, and the list is the only
 * authority. While the list is still loading a candidate is trusted
 * provisionally so a returning reader's scoped requests can start in the same
 * render as `me`; the backend still membership-checks every one of them.
 */
export function resolveWorkspaceId({
  projectWorkspaceId,
  urlWorkspaceId,
  selectedWorkspaceId,
  workspaces,
}: WorkspaceInputs): string | null {
  if (projectWorkspaceId) return projectWorkspaceId;
  const candidates = [urlWorkspaceId, selectedWorkspaceId].filter((id): id is string =>
    Boolean(id),
  );
  if (workspaces === undefined) return candidates[0] ?? null;
  const member = candidates.find((id) => workspaces.some((workspace) => workspace.id === id));
  return member ?? workspaces[0]?.id ?? null;
}

export type ProjectInputs = {
  /** An explicit `?project=` — including the one a creation just committed. */
  requestedProjectId: string | null;
  /** This session's deliberate choice, seeded from device storage. */
  selectedProjectId: string | null;
  /** The current workspace's projects (empty while unknown). */
  projects: readonly Project[];
  /** Whether `projects` is a settled answer rather than a stale/absent one. */
  listSettled: boolean;
};

/**
 * Resolve which project is active.
 *
 * An explicit id is never substituted. That single rule is what fixes the
 * reported bug: a project created seconds ago is not yet in a list fetched
 * before it existed, and falling back to `projects[0]` there is what landed
 * people on their previous project — or, with no previous project, on an
 * empty account that then refused to create the one they had just made.
 *
 * A stored selection is different: it is only a convenience, so a SETTLED
 * list that omits it means the project is gone and the first project is the
 * right answer. An unsettled list is not evidence of anything, so the stored
 * selection holds.
 */
export function resolveProjectId({
  requestedProjectId,
  selectedProjectId,
  projects,
  listSettled,
}: ProjectInputs): string | null {
  if (requestedProjectId) return requestedProjectId;
  if (selectedProjectId) {
    if (projects.some((project) => project.id === selectedProjectId)) return selectedProjectId;
    if (!listSettled) return selectedProjectId;
  }
  return projects[0]?.id ?? null;
}

export type StatusInputs = {
  /** The URL named a workspace AND a project that does not belong to it. */
  contradictoryRequest: boolean;
  /**
   * An explicit project was requested and has not resolved yet.
   *
   * The requested id becomes the active id immediately, so a workspace list
   * that settles BEFORE the project-detail read would otherwise report
   * `ready` with no active project — and the shell would render a screen
   * against the project it is still fetching.
   */
  requestedProjectPending: boolean;
  /** The explicitly requested project is confirmed missing/unauthorized. */
  requestedProjectMissing: boolean;
  /** A read failed in a way the reader can retry. */
  failed: boolean;
  /** The membership list answered, and it is empty. */
  noWorkspace: boolean;
  workspaceId: string | null;
  activeProjectId: string | null;
  hasResolvedProject: boolean;
  listSettled: boolean;
};

/**
 * Classify the shell's state for the route gate.
 *
 * Order matters. A confirmed contradiction or absence outranks a failure,
 * which outranks "still working", which outranks an empty answer — so a
 * request that is merely in flight never presents as an empty account and
 * never triggers the create-a-project redirect.
 */
export function resolveStatus({
  contradictoryRequest,
  requestedProjectPending,
  requestedProjectMissing,
  failed,
  noWorkspace,
  workspaceId,
  activeProjectId,
  hasResolvedProject,
  listSettled,
}: StatusInputs): SelectionStatus {
  if (contradictoryRequest || requestedProjectMissing) return 'unavailable';
  if (failed) return 'error';
  if (noWorkspace) return 'no_workspace';
  if (requestedProjectPending) return 'resolving';
  // A resolved project is usable on its own. Holding the shell for a list
  // refetch that only reconciles what is already known is what made a brand
  // new project look absent.
  if (hasResolvedProject) return 'ready';
  if (workspaceId === null || !listSettled) return 'resolving';
  if (activeProjectId === null) return 'empty';
  // An id with no project object behind it is not something a screen can
  // render against. Reachable only if a caller's pending flag disagrees with
  // its resolved project, so it fails safe to the loader rather than claiming
  // a readiness nothing can satisfy.
  return 'resolving';
}

/**
 * Pick the object for the resolved id.
 *
 * A directly-resolved project wins: it is authoritative for the id in the URL
 * and it lands a round trip before the list reconciles, which is what lets a
 * just-created project be usable the moment its destination mounts.
 */
export function pickActiveProject(
  resolvedProject: Project | null,
  projects: readonly Project[],
  activeProjectId: string | null,
): Project | null {
  if (resolvedProject?.id === activeProjectId) return resolvedProject;
  return projects.find((project) => project.id === activeProjectId) ?? null;
}

export type FailureInputs = {
  /** The explicit project read failed for a reason other than "not found". */
  detailFailed: boolean;
  /** The membership read failed, so no workspace can be resolved. */
  membershipFailed: boolean;
  /** The project list failed AND left nothing usable behind. */
  listFailedWithNothingUsable: boolean;
};

/** Which read failed, so the reader can be told what actually went wrong. */
export type FailureScope = 'workspace' | 'projects' | null;

/**
 * Name the failing read.
 *
 * Membership outranks the rest: with no workspace resolved, the project reads
 * never had a chance. Saying "your workspace could not be loaded" when only
 * the project list 403'd is simply false, and it sends the reader looking for
 * an access problem that is not there.
 */
export function resolveFailureScope({
  detailFailed,
  membershipFailed,
  listFailedWithNothingUsable,
}: FailureInputs): FailureScope {
  if (membershipFailed) return 'workspace';
  if (detailFailed || listFailedWithNothingUsable) return 'projects';
  return null;
}

/**
 * Whether a read failed in a way the reader can recover from by retrying.
 *
 * A list failure only counts when it left the shell with no usable project: a
 * reconciling refetch that fails behind an already-resolved project is not an
 * error the reader needs to see, and presenting it as one is how a transient
 * network blip used to look like a broken account.
 */
export function resolveFailed({
  detailFailed,
  membershipFailed,
  listFailedWithNothingUsable,
}: FailureInputs): boolean {
  return detailFailed || membershipFailed || listFailedWithNothingUsable;
}
