'use client';

import { Link } from 'react-router-dom';
import { Suspense, useEffect, useState, type ReactNode } from 'react';

import { PageLoading } from '@/components/layout/page-loading';
import { GateNoticeFrame } from '@/components/layout/gate-notice-frame';
import { ShellFallback } from '@/components/layout/shell-fallback';
import { Button } from '@/components/ui/button';
import { WORKSPACE_LOADING_STALL_MS } from '@/lib/config/operational';
import { workspaceDestination } from '@/lib/navigation/project-destination';
import { useProjectContext } from '@/lib/project/project-context';

import { OnboardingScreen } from './onboarding-screen';

export function OnboardingPageClient() {
  return (
    <Suspense fallback={<ShellFallback />}>
      <ProjectSetupGate />
    </Suspense>
  );
}

/**
 * The creation screen's own precondition check.
 *
 * It asks about the WORKSPACE: whether it is resolved. A workspace with no
 * projects is a normal starting point here, so an empty list is never an
 * error.
 */
function ProjectSetupGate() {
  const { status, activeWorkspaceId, retry } = useProjectContext();

  const projectsHref = activeWorkspaceId
    ? workspaceDestination('/projects', null, activeWorkspaceId)
    : '/projects';

  // Every settled FAILURE is answered before the loading branch. A failed
  // workspace read leaves `activeWorkspaceId` null forever, so testing for it
  // first hid the retry behind a spinner that never resolved.
  if (status === 'error') {
    return (
      <ProjectSetupBlocked
        title="Your workspace could not be loaded"
        onRetry={retry}
        projectsHref={projectsHref}
      >
        We could not confirm which workspace to create this project in. Retry to load it again.
      </ProjectSetupBlocked>
    );
  }
  if (status === 'unavailable') {
    // Reached by linking here with a `?project=` that is missing, unauthorized,
    // or contradicts the workspace. Creating a project is not the answer to a
    // request that named a different one.
    return (
      <ProjectSetupBlocked title="That project is unavailable" projectsHref={projectsHref}>
        The project this link names could not be opened. Go back to your projects to continue.
      </ProjectSetupBlocked>
    );
  }
  if (status === 'resolving' || activeWorkspaceId === null) {
    return <ProjectSetupLoading onRetry={retry} projectsHref={projectsHref} />;
  }
  return <OnboardingScreen />;
}

function ProjectSetupLoading({
  onRetry,
  projectsHref,
}: Readonly<{ onRetry: () => void; projectsHref: string }>) {
  const [stalled, setStalled] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => setStalled(true), WORKSPACE_LOADING_STALL_MS);
    return () => window.clearTimeout(timer);
  }, [attempt]);

  if (!stalled) return <PageLoading label="Loading your workspace…" />;
  return (
    <ProjectSetupBlocked
      title="Your workspace is taking longer to load"
      projectsHref={projectsHref}
      onRetry={() => {
        setStalled(false);
        setAttempt((current) => current + 1);
        onRetry();
      }}
    >
      Retry the workspace check to continue.
    </ProjectSetupBlocked>
  );
}

function ProjectSetupBlocked({
  title,
  children,
  onRetry,
  projectsHref,
}: Readonly<{
  title: string;
  children: ReactNode;
  onRetry?: () => void;
  projectsHref: string;
}>) {
  return (
    <main
      id="main"
      className="bg-background grid min-h-dvh place-items-center p-[var(--page-section-gap)]"
    >
      <GateNoticeFrame title={title}>
        <p>{children}</p>
        {onRetry && (
          <Button onClick={onRetry} className="w-fit">
            Retry
          </Button>
        )}
        <Button asChild variant="secondary" className="w-fit">
          <Link to={projectsHref}>Back to projects</Link>
        </Button>
      </GateNoticeFrame>
    </main>
  );
}
