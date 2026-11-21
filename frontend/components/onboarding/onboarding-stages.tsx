import { useEffect, useRef, type ReactNode } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { Link } from 'react-router-dom';

import { SetupStep, StepColumns, StepFindings, StepTrail } from '@/components/templates/setup-page';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Stack } from '@/components/ui/layout';
import { MarketSelect } from '@/components/ui/market-select';
import { type TrailStep } from '@/components/ui/rung-trail';
import { MARKET_COUNTRIES, MARKET_LANGUAGES } from '@citeladder/contracts/markets';
import { isPlanLimit, PLANS_HREF } from '@/lib/billing/plan-limit';
import { discoveryActivity } from '@/lib/onboarding/discovery-activity';
import { onboardingErrorMessage, type BrandStepValues } from '@/lib/onboarding/forms';
import { hasConfirmedIcp, IcpAudience, IcpCategory } from './icp-confirmation';
import { ReviewStep } from './review-step';
import { useStaggeredSteps } from './use-staggered-steps';
import { Notice } from '@/components/ui/notice';

const MARKET_OPTIONS = [{ value: 'GLOBAL', label: 'Global' }, ...MARKET_COUNTRIES];

export const STAGE_HEADING_ID = 'onboarding-stage-heading';

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
    <SetupStep
      titleId={STAGE_HEADING_ID}
      title={isAdditional ? 'Add a project' : 'Add your brand'}
      back={actions.back}
      next={actions.next}
    >
      <form id="onboarding-brand-form" noValidate onSubmit={onSubmit}>
        <StepColumns>
          <Field label="Brand name" required error={form.formState.errors.brand_name?.message}>
            {(props) => (
              <Input
                {...props}
                {...form.register('brand_name')}
                autoComplete="organization"
                placeholder="Acme"
              />
            )}
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
        </StepColumns>
      </form>
    </SetupStep>
  );
}

export function DiscoveryStage({
  discovery,
  onEdit,
  onRerun,
  actions,
}: Readonly<{
  discovery: {
    discovery: ReturnType<
      typeof import('@/lib/onboarding/use-brand-discovery').useBrandDiscovery
    >['discovery'];
    error: Error | null;
    isRunning: boolean;
    retry: () => void;
  };
  onEdit: () => void;
  onRerun: () => void;
  actions: StageActions;
}>) {
  const found = discoveryResults(discovery.discovery);
  const warnings = discovery.discovery?.warnings ?? [];
  const failed = discovery.discovery?.status === 'failed';
  const errorCode = discovery.discovery?.error_code ?? '';
  const rerunWarning = failed ? undefined : warnings.find((code) => RERUN_WARNINGS.has(code));
  const rerun = (
    <Button variant="secondary" onClick={onRerun} disabled={discovery.isRunning}>
      Run discovery again
    </Button>
  );
  return (
    <SetupStep
      titleId={STAGE_HEADING_ID}
      title="Finding what to track"
      back={actions.back}
      next={actions.next}
    >
      <StepColumns>
        <div className="min-w-0">
          <StageSteps
            label="Discovering your brand"
            steps={discoveryActivity(discovery.discovery)}
            stagger
          />
        </div>
        {found.length > 0 ? <StepFindings title="Found so far" items={found} /> : null}
      </StepColumns>
      {warningCallouts(warnings, rerunWarning).map(({ message, rerunnable }) => (
        <Notice key={message} tone="warning" action={rerunnable ? rerun : undefined}>
          {message}
        </Notice>
      ))}
      {failed ? (
        <Notice
          tone="negative"
          action={<FailureRecovery code={errorCode} rerun={rerun} onEdit={onEdit} />}
        >
          {failureMessage(errorCode)}
        </Notice>
      ) : null}
      {discovery.error ? (
        <Notice
          tone="warning"
          action={
            <Button variant="secondary" onClick={discovery.retry}>
              Retry
            </Button>
          }
        >
          {onboardingErrorMessage(discovery.error)}
        </Notice>
      ) : null}
    </SetupStep>
  );
}

export function CreationStage({
  committedProjectId,
}: Readonly<{ committedProjectId: string | null }>) {
  const projectCommitted = committedProjectId !== null;
  const steps: TrailStep[] = [
    {
      id: 'save',
      label: 'Saving your project',
      status: projectCommitted ? 'done' : 'running',
    },
    {
      id: 'open',
      label: 'Opening your workspace',
      status: projectCommitted ? 'running' : 'pending',
    },
  ];

  return (
    <div aria-busy="true">
      <SetupStep titleId={STAGE_HEADING_ID} title="Creating your project">
        <StageSteps label="Project creation progress" steps={steps} />
      </SetupStep>
    </div>
  );
}

function StageSteps({
  label,
  steps,
  stagger = false,
}: Readonly<{ label: string; steps: readonly TrailStep[]; stagger?: boolean }>) {
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
      <StepTrail label={label} steps={shown.steps} />
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
    <SetupStep
      titleId={STAGE_HEADING_ID}
      title="Does this look right?"
      back={actions.back}
      next={actions.next}
    >
      <ReviewNotices failed={complete.isError}>
        {catalog.isError ? (
          <Notice
            tone="warning"
            action={
              <Button variant="secondary" onClick={() => catalog.refetch()}>
                Try again
              </Button>
            }
          >
            Couldn&apos;t load the competitor limit.
          </Notice>
        ) : null}
        {complete.isError ? (
          <Notice tone="warning">{onboardingErrorMessage(complete.error)}</Notice>
        ) : null}
        <CompletionStateAlert failed={completionFailed} />
      </ReviewNotices>
      <StepColumns>
        <Stack gap="workspace" className="min-w-0">
          <ReviewStep
            domains={domains}
            competitors={competitors}
            onToggleDomain={toggle(flow.setDomains)}
            onToggleCompetitor={(index) =>
              toggleCompetitor(index, setCompetitors, maximumCompetitors)
            }
            onEditCompetitor={(index, name, domain) =>
              editCompetitor(index, name, domain, setCompetitors)
            }
            onRemoveCompetitor={(index) =>
              setCompetitors((current) => current.filter((_, itemIndex) => itemIndex !== index))
            }
            onAddCompetitor={() => addCompetitor(setCompetitors, maximumCompetitors)}
            maximumCompetitors={maximumCompetitors}
            domainNote={
              hasSelectedDomain ? undefined : 'Keep at least one website address selected.'
            }
            competitorNote={
              flow.hasIncompleteCompetitor
                ? 'Add a name and website for each selected competitor.'
                : undefined
            }
          />
        </Stack>
        {profile ? (
          <Stack gap="workspace" className="min-w-0">
            <IcpCategory
              profile={profile}
              onChange={setProfile}
              note={hasConfirmedIcp(profile) ? undefined : 'Choose or describe what you sell.'}
            />
            <IcpAudience profile={profile} onChange={setProfile} />
          </Stack>
        ) : null}
      </StepColumns>
    </SetupStep>
  );
}

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
    return <Notice tone="negative">Project creation did not finish.</Notice>;
  }
  return null;
}

const RERUN_WARNINGS = new Set(['research_degraded', 'competitors_not_found']);
const SITE_FAILURES = new Set(['invalid_url', 'site_not_found', 'ssrf_blocked', 'out_of_scope']);

function FailureRecovery({
  code,
  rerun,
  onEdit,
}: Readonly<{ code: string; rerun: ReactNode; onEdit: () => void }>) {
  if (isPlanLimit(code))
    return (
      <Button asChild variant="secondary">
        <Link to={PLANS_HREF}>See plans</Link>
      </Button>
    );
  if (!SITE_FAILURES.has(code)) return rerun;
  return (
    <>
      <Button variant="secondary" onClick={onEdit}>
        Edit website
      </Button>
      {rerun}
    </>
  );
}

function failureMessage(code: string): string {
  if (code === 'ai_credits_exhausted') return 'Out of AI credits.';
  if (code === 'invalid_url') return 'The website address is invalid.';
  if (SITE_FAILURES.has(code)) return 'We could not open this website.';
  return 'Research did not finish.';
}

/** One callout per distinct message: several codes share the same reader-facing text. */
export function warningCallouts(warnings: readonly string[], rerunWarning: string | undefined) {
  const callouts = new Map<string, boolean>();
  for (const code of warnings) {
    const message = warningMessage(code);
    callouts.set(message, (callouts.get(message) ?? false) || code === rerunWarning);
  }
  return [...callouts].map(([message, rerunnable]) => ({ message, rerunnable }));
}

const PARTIAL_RESEARCH = 'Some website details could not be confirmed.';

function warningMessage(code: string): string {
  const messages: Record<string, string> = {
    research_degraded: PARTIAL_RESEARCH,
    competitors_not_found: 'No competitors were confirmed.',
    external_research_unavailable: PARTIAL_RESEARCH,
    external_research_no_results: PARTIAL_RESEARCH,
    conflicting_evidence: 'Sources disagreed about this business.',
    insufficient_evidence: 'Too little evidence to confirm this business.',
    site_health_deferred: 'The Website review was not started.',
  };
  return messages[code] ?? 'Some research could not be confirmed.';
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
