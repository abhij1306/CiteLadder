import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';

import { ActivityProgress, type ActivityStep } from '@/components/ui/activity-progress';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Inline, Stack } from '@/components/ui/layout';
import { MarketSelect } from '@/components/ui/market-select';
import { splitPaneClasses } from '@/components/ui/workspace';
import { MARKET_COUNTRIES, MARKET_LANGUAGES } from '@citeladder/contracts/markets';
import { discoveryActivity } from '@/lib/onboarding/discovery-activity';
import { onboardingErrorMessage, type BrandStepValues } from '@/lib/onboarding/forms';
import { hasConfirmedIcp, IcpAudience, IcpCategory } from './icp-confirmation';
import { ReviewStep } from './review-step';

const MARKET_OPTIONS = [{ value: 'GLOBAL', label: 'Global' }, ...MARKET_COUNTRIES];

/** Each stage's heading; focus moves here when the stage changes. */
export const STAGE_HEADING_ID = 'onboarding-stage-heading';

function StageHeader({ title, children }: Readonly<{ title: ReactNode; children: ReactNode }>) {
  return (
    <div className="flow-header">
      <h1 id={STAGE_HEADING_ID} tabIndex={-1} className="flow-title outline-none">
        {title}
      </h1>
      <p className="flow-help">{children}</p>
    </div>
  );
}

export function BrandStage({
  form,
  isAdditional,
  onSubmit,
}: Readonly<{
  form: UseFormReturn<BrandStepValues>;
  isAdditional: boolean;
  onSubmit: () => void;
}>) {
  return (
    <form id="onboarding-brand-form" noValidate onSubmit={onSubmit}>
      <StageHeader title={isAdditional ? 'Add a project' : "Let's get started"}>
        We&apos;ll review your website, suggest comparable brands, and prepare balanced questions.
      </StageHeader>
      <div className={splitPaneClasses('peers')}>
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
      </div>
    </form>
  );
}

export function DiscoveryStage({
  brandName,
  discovery,
  onEdit,
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
}>) {
  const found = discoveryResults(discovery.discovery);
  return (
    <div>
      <StageHeader title="Finding what to track">
        We&apos;re reading {brandName || 'your website'} and learning what you offer.
      </StageHeader>
      <ActivityProgress
        label="Discovering your brand"
        steps={discoveryActivity(discovery.discovery)}
        animateCompletion
        appearance="flow"
      />
      {found.length > 0 ? (
        <section className="flow-found">
          <h2 className="flow-group-title">Found so far</h2>
          <ul className="flow-found-list">
            {found.map((item, index) => (
              <li
                key={`${item}:${index}`}
                className="flow-found-item"
                style={{ '--flow-result-index': index } as CSSProperties}
              >
                {item}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Stack gap="workspace" className="mt-[var(--flow-block)]">
        {(discovery.discovery?.warnings ?? []).map((warning) => (
          <Alert key={warning} tone="warning">
            {warningMessage(warning)}
          </Alert>
        ))}
        {discovery.discovery?.status === 'failed' ? (
          <Alert tone="danger">
            <Inline gap="compact" className="justify-between">
              <span>
                {discovery.discovery.error_code === 'invalid_url'
                  ? 'The website address is invalid. Go back and correct it.'
                  : 'We could not confirm that this website exists. Check the address and try again.'}
              </span>
              <Button variant="ghost" onClick={onEdit}>
                Edit website
              </Button>
            </Inline>
          </Alert>
        ) : null}
        {discovery.error ? (
          <Alert tone="warning">
            <Inline gap="compact" className="justify-between">
              <span>{onboardingErrorMessage(discovery.error)}</span>
              <Button variant="ghost" onClick={discovery.retry}>
                Retry
              </Button>
            </Inline>
          </Alert>
        ) : null}
      </Stack>
    </div>
  );
}

export function CreationStage({
  committedProjectId,
}: Readonly<{ committedProjectId: string | null }>) {
  const projectCommitted = committedProjectId !== null;
  const steps: ActivityStep[] = [
    {
      id: 'save',
      label: 'Saving your project',
      detail: projectCommitted
        ? 'Your confirmed details are saved.'
        : 'Your confirmed draft remains recoverable.',
      state: projectCommitted ? 'complete' : 'active',
    },
    {
      id: 'open',
      label: 'Opening your workspace',
      detail: 'Next, choose the questions you want to track.',
      state: projectCommitted ? 'active' : 'pending',
    },
  ];

  return (
    <div aria-busy="true">
      <StageHeader title="Creating your project">
        We&apos;re saving your confirmed details and will open the project as soon as it is
        committed.
      </StageHeader>
      <ActivityProgress label="Project creation progress" steps={steps} appearance="flow" />
    </div>
  );
}

export function ReviewStage({
  flow,
}: Readonly<{
  flow: ReturnType<typeof import('./onboarding-flow').useOnboardingFlow>;
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
    <div>
      <StageHeader title="Does this look right?">
        Confirm what we found before we create your project.
      </StageHeader>
      <ReviewNotices failed={complete.isError}>
        {catalog.isError ? (
          <Alert tone="warning">
            <Inline gap="compact" className="justify-between">
              <span>We could not load the competitor limit.</span>
              <Button variant="ghost" onClick={() => catalog.refetch()}>
                Try again
              </Button>
            </Inline>
          </Alert>
        ) : null}
        {complete.isError ? (
          <Alert tone="warning">{onboardingErrorMessage(complete.error)}</Alert>
        ) : null}
        <CompletionStateAlert failed={completionFailed} />
      </ReviewNotices>
      {/* The websites and competitor picks run full width first, each with its
          hint beneath; then what you sell and who buys it share a row. */}
      <div className="flow-review">
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
        />
        {!hasSelectedDomain ? (
          <p className="flow-review-hint">Keep at least one website address selected.</p>
        ) : null}
        {flow.hasIncompleteCompetitor ? (
          <p className="flow-review-hint">Add a name and website for each selected competitor.</p>
        ) : null}
        {profile ? (
          <>
            <div className="flow-review-cell">
              <IcpCategory profile={profile} onChange={setProfile} />
              {!hasConfirmedIcp(profile) ? (
                <p className="flow-review-hint">Choose or describe what you sell.</p>
              ) : null}
            </div>
            <div className="flow-review-card flow-review-audience">
              <IcpAudience profile={profile} onChange={setProfile} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Anything that stopped "Create project", above the cards it concerns.
 *
 * These used to sit below both columns — past the fold on a laptop — so a
 * refused or timed-out creation looked like a button that did nothing. A new
 * failure brings this region into view.
 */
function ReviewNotices({ failed, children }: Readonly<{ failed: boolean; children: ReactNode }>) {
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (failed) region.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [failed]);
  return (
    <div ref={region} aria-live="polite" className="flow-review-notices">
      {children}
    </div>
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
      <Alert tone="danger">
        Project creation did not finish. Go back, confirm the website again, and retry.
      </Alert>
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
