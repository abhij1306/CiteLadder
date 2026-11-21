import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { NoticePage } from '@/components/templates/notice-page';
import { isWorkspaceOnlyRoute } from '@/lib/navigation/app-routes';
import { useCanonicalProjectUrl, workspaceDestination } from '@/lib/navigation/project-destination';
import { resolveGate, type NoticeKind } from '@/lib/project/bootstrap';
import { ActiveProjectScopeProvider } from '@/lib/project/active-project-scope';
import { useProjectContext } from '@/lib/project/project-context';
import type { FailureScope } from '@/lib/project/selection';

import { RouteLoadingScreen } from './page-shell';

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
  const { status, errorScope, activeWorkspaceId, activeWorkspace, activeProject, retry } =
    useProjectContext();

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

  if (state === 'redirecting')
    return <NoticePage tone="loading" heading="Opening project setup…" />;
  if (state === 'loading') return <RouteLoadingScreen />;
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

  if (projectRequired && activeProject) {
    return (
      <ActiveProjectScopeProvider
        key={`${activeProject.workspace_id}:${activeProject.id}`}
        project={activeProject}
      >
        {children}
      </ActiveProjectScopeProvider>
    );
  }
  return <>{children}</>;
}

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
      <NoticePage
        tone="warning"
        heading="That project is unavailable"
        actions={
          <NoticeLink href={noticeHref('/projects', workspaceId)}>Go to your projects</NoticeLink>
        }
      >
        It may have been deleted, or it belongs to a workspace you do not have access to. Choose
        another project to continue.
      </NoticePage>
    );
  }
  return (
    <NoticePage
      tone="info"
      heading="This workspace has no projects"
      actions={
        <NoticeLink href={noticeHref('/settings', workspaceId)}>Open workspace settings</NoticeLink>
      }
    >
      You have read-only access to this workspace.
    </NoticePage>
  );
}

function FailureNotice({
  errorScope,
  onRetry,
}: Readonly<{ errorScope: FailureScope; onRetry: () => void }>) {
  const workspaceFailed = errorScope === 'workspace';
  return (
    <NoticePage
      tone="negative"
      heading={
        workspaceFailed ? 'Your workspace could not be loaded' : 'Projects could not be loaded'
      }
      actions={
        <Button variant="primary" onClick={onRetry}>
          Retry
        </Button>
      }
    >
      Retry to load your {workspaceFailed ? 'workspace and its projects' : 'projects'}.
    </NoticePage>
  );
}

function noticeHref(pathname: string, workspaceId: string | null): string {
  return workspaceId ? workspaceDestination(pathname, null, workspaceId) : pathname;
}

function NoticeLink({ href, children }: Readonly<{ href: string; children: ReactNode }>) {
  return (
    <Button asChild variant="primary">
      <Link to={href}>{children}</Link>
    </Button>
  );
}
