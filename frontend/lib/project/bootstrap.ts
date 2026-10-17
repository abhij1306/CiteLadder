/**
 * The application shell's opening decision, in one place.
 *
 * Which workspace, which project, and whether this route can render at all —
 * asked once, before the first paint, by `PrivateRouteLayout`'s loader, and
 * asked again on every later render by `OnboardingGate`. Both ask the same
 * question, so both call the same function; the alternative is two copies of a
 * precedence table.
 *
 * Nothing here fetches or navigates. It answers from whatever is known, and
 * the caller decides what to do about it — which is what lets the loader
 * redirect before anything mounts and the gate render a notice after.
 */
import type { SelectionStatus } from '@/lib/project/selection';

/**
 * Routes that manage the WORKSPACE rather than work inside a project.
 *
 * A workspace with no projects is a perfectly valid workspace: its settings
 * stay reachable, and project creation itself must not redirect to itself.
 */
const WORKSPACE_ONLY_PREFIXES = ['/onboarding', '/settings'] as const;

export function isWorkspaceOnlyRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return WORKSPACE_ONLY_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Which standing notice, if any, this state owes the reader. */
export type NoticeKind = 'failed' | 'missing-project' | 'no-projects';
export type GateState = NoticeKind | 'ready' | 'loading' | 'redirecting';

export type GateInputs = {
  projectRequired: boolean;
  mayCreate: boolean;
};

/** Resolve routing, loading and recovery together so their precedence cannot drift. */
export function resolveGate(
  status: SelectionStatus,
  { projectRequired, mayCreate }: GateInputs,
): GateState {
  if (status === 'error') return 'failed';
  if (status === 'unavailable') return 'missing-project';
  if (!projectRequired) return 'ready';
  if (status === 'no_workspace') return 'failed';
  if (status === 'resolving') return 'loading';
  if (status !== 'empty') return 'ready';
  return mayCreate ? 'redirecting' : 'no-projects';
}
