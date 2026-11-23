import { Link } from 'react-router-dom';
import { Suspense, useEffect, useState, type ReactNode } from 'react';

import { FirstFrame } from '@/components/layout/first-frame';
import { UserMenuTrigger } from '@/components/layout/user-menu';
import { FlowBlock, FlowPage } from '@/components/templates/flow-page';
import { AuthActions } from '@/components/ui/auth-shell';
import { Button } from '@/components/ui/button';

import { WORKSPACE_LOADING_STALL_MS } from '@/lib/config/operational';
import { workspaceDestination } from '@/lib/navigation/project-destination';
import { useProjectContext } from '@/lib/project/project-context';

import { OnboardingScreen } from './onboarding-screen';

export function OnboardingPageClient() {
  return (
    <Suspense fallback={<FirstFrame />}>
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

  if (status === 'error') {
    return (
      <ProjectSetupBlocked
        title="Your workspace could not be loaded"
        onRetry={retry}
        projectsHref={projectsHref}
      />
    );
  }
  if (status === 'unavailable') {
    return <ProjectSetupBlocked title="That project is unavailable" projectsHref={projectsHref} />;
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

  if (!stalled) return <FirstFrame />;
  return (
    <ProjectSetupBlocked
      title="Your workspace is taking longer to load"
      projectsHref={projectsHref}
      onRetry={() => {
        setStalled(false);
        setAttempt((current) => current + 1);
        onRetry();
      }}
    />
  );
}

function ProjectSetupBlocked({
  title,
  children,
  onRetry,
  projectsHref,
}: Readonly<{
  title: string;
  children?: ReactNode;
  onRetry?: () => void;
  projectsHref: string;
}>) {
  return (
    <FlowPage label="Project setup" barEnd={<UserMenuTrigger presenter="compact" />}>
      <FlowBlock title={title} sub={children}>
        <AuthActions>
          {onRetry && (
            <Button variant="primary" onClick={onRetry}>
              Retry
            </Button>
          )}
          <Button asChild variant="secondary">
            <Link to={projectsHref}>Back to projects</Link>
          </Button>
        </AuthActions>
      </FlowBlock>
    </FlowPage>
  );
}
