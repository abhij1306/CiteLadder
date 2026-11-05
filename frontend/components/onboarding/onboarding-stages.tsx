import { useEffect, useRef, type ReactNode } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Stack } from '@/components/ui/layout';
import { MarketSelect } from '@/components/ui/market-select';
import { OnboardingStep, StepFindings } from '@/components/ui/onboarding-shell';
import { StepList, type Step } from '@/components/ui/step-list';
import { MARKET_COUNTRIES, MARKET_LANGUAGES } from '@citeladder/contracts/markets';
import { discoveryActivity } from '@/lib/onboarding/discovery-activity';
import { onboardingErrorMessage, type BrandStepValues } from '@/lib/onboarding/forms';
import { hasConfirmedIcp, IcpAudience, IcpCategory } from './icp-confirmation';
import { ReviewStep } from './review-step';
import { useStaggeredSteps } from './use-staggered-steps';

const MARKET_OPTIONS = [{ value: 'GLOBAL', label: 'Global' }, ...MARKET_COUNTRIES];

/** Each stage's heading; focus moves here when the stage changes. */
export const STAGE_HEADING_ID = 'onboarding-stage-heading';

/** A stage's footer: the way back (none on the first step) and its one ink action. */
export type StageActions = Readonly<{ back?: ReactNode; next: ReactNode }>;

export function BrandStage({
  form,
  isAdditional,
  onSubmit,
  actions,
}: Readonly<{
  form: UseFormReturn<BrandStepValues>;
  isAdditional: boolean;
  onSubmit: () => void;
  actions: StageActions;
}>) {
  return (
    <OnboardingStep
      titleId={STAGE_HEADING_ID}
      title={isAdditional ? 'Add a project' : "Let's get started"}
      help="We'll review your website, suggest comparable brands, and prepare balanced questions."
      back={actions.back}
      next={actions.next}
    >
      <form id="onboarding-brand-form" noValidate onSubmit={onSubmit}>
        <Stack gap="workspace">
          <Field label="Brand name" required error={form.formState.errors.brand_name?.message}>
            {(props) => <Input {...props} {...form.register('brand_name')} placeholder="Acme" />}
          </Field>
          <Field label="Website" required error={form.formState.errors.website_url?.message}>
            {(props) => (
              <Input
                {...props}
                {...form.register('website_url')}
                placeholder="acme.com"
                inputMode="url"
              />
            )}
          </Field>
          <Field label="Primary market" error={form.formState.errors.primary_market?.message}>
            {(props) => (
              <Controller
                control={form.control}
                name="primary_market"
                render={({ field }) => (
                  <MarketSelect
                    {...props}
                    ariaLabel="Primary market"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    options={MARKET_OPTIONS}
                    showCountryFlags
                  />
                )}
              />
            )}
          </Field>
          <Field label="Language" error={form.formState.errors.language_code?.message}>
            {(props) => (
              <Controller
                control={form.control}
                name="language_code"
                render={({ field }) => (
                  <MarketSelect
                    {...props}
                    ariaLabel="Language"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    options={MARKET_LANGUAGES}
                  />
                )}
              />
            )}
          </Field>
        </Stack>
      </form>
    </OnboardingStep>
  );
}

export function DiscoveryStage({
  brandName,
  discovery,
  onEdit,
  actions,
}: Readonly<{
  brandName: string | undefined;
  discovery: {
    discovery: ReturnType<
      typeof import('@/lib/onboarding/use-brand-discovery').useBrandDiscovery
    >['discovery'];
    error: Error | null;
    isRunning: boolean;
    retry: () => void;
  };
  onEdit: () => void;
  actions: StageActions;
}>) {
  const found = discoveryResults(discovery.discovery);
  return (
    <OnboardingStep
      titleId={STAGE_HEADING_ID}
      title="Finding what to track"
      help={`We're reading ${brandName || 'your website'} and learning what you offer.`}
      back={actions.back}
      next={actions.next}
    >
      <StageSteps
        label="Discovering your brand"
        steps={discoveryActivity(discovery.discovery)}
        stagger
      />
      {found.length > 0 ? <StepFindings title="Found so far" items={found} /> : null}
      {(discovery.discovery?.warnings ?? []).map((warning) => (
        <Callout key={warning} tone="warning">
          {warningMessage(warning)}
        </Callout>
      ))}
      {discovery.discovery?.status === 'failed' ? (
        <Callout
          tone="negative"
          action={
            <Button variant="secondary" onClick={onEdit}>
              Edit website
            </Button>
          }
        >
          {discovery.discovery.error_code === 'invalid_url'
            ? 'The website address is invalid. Go back and correct it.'
            : 'We could not confirm that this website exists. Check the address and try again.'}
        </Callout>
      ) : null}
      {discovery.error ? (
        <Callout
          tone="warning"
          action={
            <Button variant="secondary" onClick={discovery.retry}>
              Retry
            </Button>
          }
        >
          {onboardingErrorMessage(discovery.error)}
        </Callout>
      ) : null}
    </OnboardingStep>
  );
}

export function CreationStage({
  committedProjectId,
}: Readonly<{ committedProjectId: string | null }>) {
  const projectCommitted = committedProjectId !== null;
  const steps: Step[] = [
    {
      id: 'save',
      label: 'Saving your project',
      detail: projectCommitted
        ? 'Your confirmed details are saved.'
        : 'Your confirmed draft remains recoverable.',
      status: projectCommitted ? 'done' : 'running',
    },
    {
      id: 'open',
      label: 'Opening your workspace',
      detail: 'Next, choose the questions you want to track.',
      status: projectCommitted ? 'running' : 'pending',
    },
  ];

  return (
    <div aria-busy="true">
      <OnboardingStep
        titleId={STAGE_HEADING_ID}
        title="Creating your project"
        help="We're saving your confirmed details and will open the project as soon as it is committed."
      >
        <StageSteps label="Project creation progress" steps={steps} />
      </OnboardingStep>
    </div>
  );
}

/**
 * A stage's steps, with the overall count as a (visually hidden) progress bar
 * and the step being worked on announced politely.
 */
function StageSteps({
  label,
  steps,
  stagger = false,
}: Readonly<{ label: string; steps: readonly Step[]; stagger?: boolean }>) {
  const shown = useStaggeredSteps(steps, stagger);
  return (
    <>
      <progress
        className="sr-only"
        aria-label={`${shown.done} of ${steps.length} steps complete`}
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={shown.done}
        value={shown.done}
        max={Math.max(steps.length, 1)}
      />
      <StepList label={label} steps={shown.steps} />
      <span className="sr-only" aria-live="polite">
        {shown.announcement}
      </span>
    </>
  );
}

export function ReviewStage({
  flow,
  actions,
}: Readonly<{
  flow: ReturnType<typeof import('./onboarding-flow').useOnboardingFlow>;
  actions: StageActions;
}>) {
  const {
    catalog,
    competitors,
    complete,
    completionFailed,
    domains,
    hasSelectedDomain,
    maximumCompetitors,
    profile,
    setCompetitors,
    setProfile,
    toggle,
  } = flow;
  return (
    <OnboardingStep
      titleId={STAGE_HEADING_ID}
      title="Does this look right?"
      help="Confirm what we found before we create your project."
      back={actions.back}
      next={actions.next}
    >
      <ReviewNotices failed={complete.isError}>
        {catalog.isError ? (
          <Callout
            tone="warning"
            action={
              <Button variant="secondary" onClick={() => catalog.refetch()}>
                Try again
              </Button>
            }
          >
            We could not load the competitor limit.
          </Callout>
        ) : null}
        {complete.isError ? (
          <Callout tone="warning">{onboardingErrorMessage(complete.error)}</Callout>
        ) : null}
        <CompletionStateAlert failed={completionFailed} />
      </ReviewNotices>
      {/* In reading order: the websites and competitor picks, each with the
          reason Create project waits beneath it, then what you sell and who
          buys it. */}
      <ReviewStep
        domains={domains}
        competitors={competitors}
        onToggleDomain={toggle(flow.setDomains)}
        onToggleCompetitor={(index) => toggleCompetitor(index, setCompetitors, maximumCompetitors)}
        onEditCompetitor={(index, name, domain) =>
          editCompetitor(index, name, domain, setCompetitors)
        }
        onRemoveCompetitor={(index) =>
          setCompetitors((current) => current.filter((_, itemIndex) => itemIndex !== index))
        }
        onAddCompetitor={() => addCompetitor(setCompetitors, maximumCompetitors)}
        maximumCompetitors={maximumCompetitors}
        domainNote={hasSelectedDomain ? undefined : 'Keep at least one website address selected.'}
        competitorNote={
          flow.hasIncompleteCompetitor
            ? 'Add a name and website for each selected competitor.'
            : undefined
        }
      />
      {profile ? (
        <>
          <IcpCategory
            profile={profile}
            onChange={setProfile}
            note={hasConfirmedIcp(profile) ? undefined : 'Choose or describe what you sell.'}
          />
          <IcpAudience profile={profile} onChange={setProfile} />
        </>
      ) : null}
    </OnboardingStep>
  );
}

/**
 * Anything that stopped "Create project", above the fields it concerns.
 *
 * These used to sit below both columns — past the fold on a laptop — so a
 * refused or timed-out creation looked like a button that did nothing. A new
 * failure brings this region into view. Empty, it takes no room.
 */
function ReviewNotices({ failed, children }: Readonly<{ failed: boolean; children: ReactNode }>) {
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (failed) region.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [failed]);
  return (
    <Stack ref={region} gap="workspace" aria-live="polite" className="empty:hidden">
      {children}
    </Stack>
  );
}

export function discoveryResults(
  discovery: ReturnType<
    typeof import('@/lib/onboarding/use-brand-discovery').useBrandDiscovery
  >['discovery'],
): string[] {
  if (!discovery) return [];
  const website = withoutTrailingSlashes(
    String(discovery.input_data.website_url ?? '').replace(/^https?:\/\//, ''),
  );
  return [website, ...discovery.competitors.map((competitor) => competitor.name)].filter(Boolean);
}

function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

function CompletionStateAlert({ failed }: Readonly<{ failed: boolean }>) {
  if (failed) {
    return (
      <Callout tone="negative">
        Project creation did not finish. Go back, confirm the website again, and retry.
      </Callout>
    );
  }
  return null;
}

function warningMessage(code: string): string {
  const messages: Record<string, string> = {
    research_degraded:
      'We used the website details we could confirm. Review them before continuing.',
    competitors_not_found:
      'No competitors were confirmed. You can continue with none or add them yourself.',
    external_research_unavailable:
      'We used the website details we could confirm. Review them before continuing.',
    external_research_no_results:
      'We used the website details we could confirm. Review them before continuing.',
    conflicting_evidence:
      'Sources disagreed about this business. Review the suggested positioning carefully.',
    site_health_deferred:
      'The project is ready; its Site Health review will need to be started later.',
  };
  return (
    messages[code] ??
    'Some research could not be confirmed. Review the suggestions before continuing.'
  );
}

function toggleCompetitor(
  index: number,
  setCompetitors: React.Dispatch<
    React.SetStateAction<import('@/lib/onboarding/forms').ReviewCompetitor[]>
  >,
  maximum: number | undefined,
) {
  setCompetitors((items) => {
    const selected = items.filter((item) => item.selected).length;
    return items.map((item, itemIndex) =>
      itemIndex !== index || (!item.selected && (maximum === undefined || selected >= maximum))
        ? item
        : { ...item, selected: !item.selected },
    );
  });
}

function editCompetitor(
  index: number,
  name: string,
  domain: string,
  setCompetitors: React.Dispatch<
    React.SetStateAction<import('@/lib/onboarding/forms').ReviewCompetitor[]>
  >,
) {
  setCompetitors((items) =>
    items.map((item, itemIndex) =>
      itemIndex === index
        ? { ...item, domains: [domain, ...item.domains.slice(1).filter((d) => d !== domain)], name }
        : item,
    ),
  );
}

function addCompetitor(
  setCompetitors: React.Dispatch<
    React.SetStateAction<import('@/lib/onboarding/forms').ReviewCompetitor[]>
  >,
  maximum: number | undefined,
) {
  setCompetitors((items) => {
    if (maximum === undefined || items.filter((item) => item.selected).length >= maximum)
      return items;
    const id = globalThis.crypto.randomUUID();
    return [
      ...items,
      {
        id: `competitor:manual:${id}`,
        name: '',
        aliases: [],
        domains: [],
        selected: true,
      },
    ];
  });
}
