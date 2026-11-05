'use client';

import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { UserMenuTrigger } from '@/components/layout/user-menu';
import { Button } from '@/components/ui/button';
import { OnboardingShell, StepBack } from '@/components/ui/onboarding-shell';
import { TextLink } from '@/components/ui/text-link';
import { projectDestination } from '@/lib/navigation/project-destination';
import { useProjectContext } from '@/lib/project/project-context';

import { hasConfirmedIcp } from './icp-confirmation';
import { useOnboardingFlow } from './onboarding-flow';
import {
  BrandStage,
  CreationStage,
  DiscoveryStage,
  ReviewStage,
  STAGE_HEADING_ID,
  type StageActions,
} from './onboarding-stages';

const STEPS = ['Basics', 'Research', 'Confirm'] as const;

/** The onboarding transaction coordinator; each visual stage owns its own UI. */
export function OnboardingScreen() {
  const location = useLocation();
  // Cached routes may retain component state. A fresh Add project URL must
  // start a fresh transaction, and a hidden route must not keep redirecting.
  if (stripTrailingSlashes(location.pathname) !== '/onboarding') return null;
  // Draft replacements retain this entry's transaction. An explicit navigation
  // gets a new key, even when it opens another draft without leaving this route.
  const transactionKey: string = location.state?.onboardingTransactionKey ?? location.key;
  return <OnboardingTransaction key={transactionKey} transactionKey={transactionKey} />;
}

function OnboardingTransaction({ transactionKey }: Readonly<{ transactionKey: string }>) {
  const flow = useOnboardingFlow(transactionKey);
  const { activeProjectId } = useProjectContext();
  /**
   * Where leaving setup would land — or nothing, when leaving has nowhere to go.
   *
   * `?new=1` says the reader ASKED for another project, not that they have one.
   * "Add project" on the empty state sets it too, so a workspace with no
   * projects was offered a way out to `/projects`, which is precisely the
   * address that sends an empty workspace back into setup. The reader saw a
   * flicker and landed back in the flow they were trying to leave.
   *
   * A resolved project is the honest test: it is both the thing to return to
   * and the proof that returning goes somewhere.
   */
  const projectsHref = activeProjectId
    ? projectDestination('/projects', null, activeProjectId)
    : undefined;
  useStageHeadingFocus(flow.isCompleting ? 'creating' : flow.step);
  // No exit unless there is somewhere to exit to; the account menu beside this
  // reaches settings when there is no project to go back to.
  const exitHref = flow.isAdditional ? projectsHref : undefined;

  return (
    <OnboardingShell
      mainLabel="Project setup"
      steps={STEPS}
      current={flow.step}
      barEnd={
        <>
          {exitHref ? (
            <TextLink asChild>
              <Link to={exitHref}>Exit</Link>
            </TextLink>
          ) : null}
          <UserMenuTrigger presenter="compact" />
        </>
      }
    >
      {onboardingStage(flow, flow.isCompleting ? undefined : stageActions(flow, projectsHref))}
    </OnboardingShell>
  );
}

/**
 * Move focus to the new stage's heading when the stage changes, so keyboard
 * and screen-reader users start at the top of what replaced the old stage.
 * The first render leaves focus where the page load put it.
 */
function useStageHeadingFocus(stage: string | number) {
  const previous = useRef(stage);
  useEffect(() => {
    if (previous.current === stage) return;
    previous.current = stage;
    document.getElementById(STAGE_HEADING_ID)?.focus();
  }, [stage]);
}

function stripTrailingSlashes(pathname: string): string {
  let end = pathname.length;
  while (end > 1 && pathname[end - 1] === '/') end -= 1;
  return pathname.slice(0, end);
}

function onboardingStage(
  flow: ReturnType<typeof useOnboardingFlow>,
  actions: StageActions | undefined,
) {
  if (flow.isCompleting || !actions) {
    return <CreationStage committedProjectId={flow.completedProjectId} />;
  }
  if (flow.step === 0) {
    return (
      <BrandStage
        form={flow.form}
        isAdditional={flow.isAdditional}
        onSubmit={flow.submitBrand}
        actions={actions}
      />
    );
  }
  if (flow.step === 1) {
    return (
      <DiscoveryStage
        brandName={flow.brand?.brand_name}
        discovery={flow.discovery}
        onEdit={() => flow.setStep(0)}
        actions={actions}
      />
    );
  }
  return <ReviewStage flow={flow} actions={actions} />;
}

/** Each stage's Back and its one ink action, in the step card's footer. */
function stageActions(
  flow: ReturnType<typeof useOnboardingFlow>,
  projectsHref: string | undefined,
): StageActions {
  if (flow.step === 0) {
    return {
      back:
        // Same rule as the exit above: cancelling has to lead somewhere.
        flow.isAdditional && projectsHref ? (
          <Button asChild variant="ghost">
            <Link to={projectsHref}>Cancel</Link>
          </Button>
        ) : undefined,
      next: (
        <Button type="submit" variant="primary" form="onboarding-brand-form">
          Continue
        </Button>
      ),
    };
  }

  if (flow.step === 1) {
    const discoveryReady =
      !flow.discovery.isRunning && flow.discovery.discovery?.status === 'ready';
    return {
      back: <StepBack onClick={() => flow.setStep(0)} />,
      next: (
        <Button variant="primary" onClick={() => flow.setStep(2)} disabled={!discoveryReady}>
          {flow.discovery.isRunning ? 'Searching…' : 'Review'}
        </Button>
      ),
    };
  }

  return {
    back: <StepBack onClick={() => flow.setStep(1)} disabled={flow.isCompleting} />,
    next: (
      <Button
        variant="primary"
        onClick={() => flow.complete.mutate()}
        pending={flow.isCompleting}
        pendingLabel="Creating…"
        disabled={
          flow.completionFailed ||
          !flow.hasSelectedDomain ||
          flow.hasIncompleteCompetitor ||
          !hasConfirmedIcp(flow.profile)
        }
      >
        Create project
      </Button>
    ),
  };
}
