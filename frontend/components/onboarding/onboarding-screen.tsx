import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { UserMenuTrigger } from '@/components/layout/user-menu';
import { SetupPage, StepBack } from '@/components/templates/setup-page';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { TextLink } from '@/components/ui/text-link';
import { X } from '@/lib/icons';
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

export function OnboardingScreen() {
  const location = useLocation();
  if (stripTrailingSlashes(location.pathname) !== '/onboarding') return null;
  const transactionKey: string = location.state?.onboardingTransactionKey ?? location.key;
  return <OnboardingTransaction key={transactionKey} transactionKey={transactionKey} />;
}

function OnboardingTransaction({ transactionKey }: Readonly<{ transactionKey: string }>) {
  const flow = useOnboardingFlow(transactionKey);
  const { activeProjectId } = useProjectContext();
  const projectsHref = activeProjectId
    ? projectDestination('/projects', null, activeProjectId)
    : undefined;
  useStageHeadingFocus(flow.isCompleting ? 'creating' : flow.step);
  // No exit unless there is somewhere to exit to; the account menu beside this
  // reaches settings when there is no project to go back to.
  const exitHref = flow.isAdditional ? projectsHref : undefined;

  return (
    <SetupPage
      label="Project setup"
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
    </SetupPage>
  );
}

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
        discovery={flow.discovery}
        onEdit={() => flow.setStep(0)}
        onRerun={flow.rerunDiscovery}
        actions={actions}
      />
    );
  }
  return <ReviewStage flow={flow} actions={actions} />;
}

function stageActions(
  flow: ReturnType<typeof useOnboardingFlow>,
  projectsHref: string | undefined,
): StageActions {
  if (flow.step === 0) {
    return {
      back:
        flow.isAdditional && projectsHref ? (
          <Button asChild variant="quiet">
            <Link to={projectsHref}>
              <Icon icon={X} />
              Cancel
            </Link>
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
