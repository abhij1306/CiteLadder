'use client';

import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';

import { GateNoticeFrame } from '@/components/layout/gate-notice-frame';
import { Button } from '@/components/ui/button';
import { QueryState } from '@/components/ui/query-state';
import { useCanonicalProjectUrl, workspaceDestination } from '@/lib/navigation/project-destination';
import { isWorkspaceOnlyRoute, resolveGate, type NoticeKind } from '@/lib/project/bootstrap';
import { useProjectContext } from '@/lib/project/project-context';
import type { FailureScope } from '@/lib/project/selection';

/**
 * The project-route gate.
 *
 * It answers exactly one question: **does this authorized workspace need
 * project onboarding on this project-required route?** It deliberately does
 * not answer whether the signed-in user has projects anywhere, which is what
 * the old length-of-a-list check was really measuring.
 *
 * Every wait is one state. An unresolved context shows the loader and
 * redirects nowhere; a failed read offers Retry instead of looking like an
 * empty account; a project that is confirmed missing says so and offers a way
 * out. Only a workspace whose project list came back successfully EMPTY, with
 * no project resolved and creation permitted by role, sends the
 * reader to onboarding.
 */
export function OnboardingGate({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = useLocation().pathname;
  const { status, errorScope, activeWorkspaceId, activeWorkspace, retry } = useProjectContext();

  // A role that may not create a project is not offered the affordance. This
  // reads the effective capability the backend published, not a role name, and
  // the backend still enforces the denial itself.
  const mayCreate = activeWorkspace?.capabilities.includes('write') ?? false;
  const projectRequired = !isWorkspaceOnlyRoute(pathname);
  const state = resolveGate(status, {
    projectRequired,
    mayCreate,
  });

  useOnboardingRedirect(state === 'redirecting', activeWorkspaceId);
  useCanonicalProjectUrl(status === 'ready' && projectRequired);

  if (state === 'redirecting') return <QueryState kind="loading" label="Opening project setup…" />;
  if (state === 'loading') return <QueryState kind="loading" label="Loading your workspace…" />;
  if (state !== 'ready') {
    return (
      <GateNotice
        kind={state}
        workspaceId={activeWorkspaceId}
        errorScope={errorScope ?? 'projects'}
        onRetry={retry}
      />
    );
  }

  return <>{children}</>;
}

/**
 * Send an empty workspace to project creation, CARRYING the workspace.
 *
 * Refreshing the creation route, or reaching it in an account with more than
 * one membership, must not silently change which workspace the project ends
 * up in.
 */
function useOnboardingRedirect(redirecting: boolean, workspaceId: string | null) {
  const router = useNavigate();
  useEffect(() => {
    if (!redirecting) return;
    router(workspaceId ? workspaceDestination('/onboarding', null, workspaceId) : '/onboarding', {
      replace: true,
    });
  }, [redirecting, workspaceId, router]);
}

function GateNotice({
  kind,
  workspaceId,
  errorScope,
  onRetry,
}: Readonly<{
  kind: NoticeKind;
  workspaceId: string | null;
  errorScope: FailureScope;
  onRetry: () => void;
}>) {
  if (kind === 'failed') return <FailureNotice errorScope={errorScope} onRetry={onRetry} />;
  if (kind === 'missing-project') {
    return (
      <NoticeShell title="That project is unavailable">
        <p>
          It may have been deleted, or it belongs to a workspace you do not have access to. Choose
          another project to continue.
        </p>
        <NoticeLink href={noticeHref('/projects', workspaceId)}>Go to your projects</NoticeLink>
      </NoticeShell>
    );
  }
  return (
    <NoticeShell title="This workspace has no projects">
      <p>You have read-only access to this workspace.</p>
      <NoticeLink href={noticeHref('/settings', workspaceId)}>Open workspace settings</NoticeLink>
    </NoticeShell>
  );
}

/**
 * Say which read failed.
 *
 * Reporting a workspace failure when only the project list 403'd sent readers
 * looking for an access problem that was not there — the workspace had
 * resolved perfectly well.
 */
function FailureNotice({
  errorScope,
  onRetry,
}: Readonly<{ errorScope: FailureScope; onRetry: () => void }>) {
  const workspaceFailed = errorScope === 'workspace';
  return (
    <NoticeShell
      title={
        workspaceFailed ? 'Your workspace could not be loaded' : 'Projects could not be loaded'
      }
    >
      <p>Retry to load your {workspaceFailed ? 'workspace and its projects' : 'projects'}.</p>
      <Button variant="secondary" className="w-fit" onClick={onRetry}>
        Retry
      </Button>
    </NoticeShell>
  );
}

/**
 * Carry the workspace out of a notice.
 *
 * These links are the reader's only way forward from a dead end, and the
 * workspace they are in is not necessarily the one that resolves by default.
 * Naming it keeps the destination in the same workspace even when device
 * storage is unavailable.
 */
function noticeHref(pathname: string, workspaceId: string | null): string {
  return workspaceId ? workspaceDestination(pathname, null, workspaceId) : pathname;
}

function NoticeLink({ href, children }: Readonly<{ href: string; children: ReactNode }>) {
  return (
    <Button asChild variant="secondary" className="w-fit">
      <Link to={href}>{children}</Link>
    </Button>
  );
}

function NoticeShell({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="grid min-h-[60vh] place-items-center py-[var(--page-section-gap)]">
      <GateNoticeFrame title={title}>{children}</GateNoticeFrame>
    </section>
  );
}
