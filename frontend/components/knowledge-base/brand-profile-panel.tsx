'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, X } from 'lucide-react';
import { useId, useState, type ComponentType, type ReactNode } from 'react';

import { Alert } from '@/components/ui/alert';
import { BrandLogo } from '@/components/ui/brand-logo';
import { Button, IconButton } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { panelClasses } from '@/components/ui/panel';
import { RadioGroup } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { splitPaneClasses } from '@/components/ui/workspace';
import { projectsApi } from '@/lib/api/projects';
import { queryKeys } from '@/lib/api/query-keys';
import { brandProfileDraftSchema } from '@citeladder/contracts';
import type { BrandProfile, BrandProfileDraft, Project } from '@/lib/api/types';
import { humanizeApiError } from '@/lib/api/errors';
import { textRole } from '@/components/ui/typography';
import {
  BUYER_TYPE_CHOICES,
  MARKET_SCOPE_CHOICES,
  identityFacets,
  type IdentityFacets,
} from '@/lib/project/identity-facets';
import { useActiveWorkspaceId } from '@/lib/project/project-context';

import { BusinessMapSummary } from './business-map-summary';

const PROFILE_TABS = [
  { id: 'facts', label: 'Facts & Positioning' },
  { id: 'audience', label: 'Audience & Offerings' },
  { id: 'map', label: 'Business map' },
  { id: 'competitors', label: 'Competitors' },
  { id: 'brand-facts', label: 'Brand facts' },
] as const;

type ProfileTab = (typeof PROFILE_TABS)[number]['id'];
/** Tabs that save on their own or not at all; the profile's Save keeps its box there. */
const SELF_SAVING_TABS: ReadonlySet<ProfileTab> = new Set(['map', 'brand-facts']);
type TrackedCompetitor = Pick<Project['competitors'][number], 'name' | 'logo_url' | 'domains'>;

function profileDraft(profile: BrandProfile): BrandProfileDraft {
  return {
    description: profile.description,
    positioning: profile.positioning,
    products_services: profile.products_services,
    target_audience: profile.target_audience,
  };
}

/** The editable profile fields, from the contract that owns them. */
const DRAFT_FIELDS = brandProfileDraftSchema.keyof().options;

/**
 * Only what the reader changed is sent, because the API marks every sent field
 * and facet reviewed. A cleared category is sent so the API can reject it.
 */
function profileUpdate(draft: BrandProfileDraft, saved: BrandProfileDraft) {
  return Object.fromEntries(
    DRAFT_FIELDS.flatMap((field) =>
      JSON.stringify(draft[field]) === JSON.stringify(saved[field]) ? [] : [[field, draft[field]]],
    ),
  ) as Partial<BrandProfileDraft>;
}

function identityUpdate(identity: IdentityFacets, saved: IdentityFacets) {
  const category = identity.category.trim();
  return {
    ...(category !== saved.category ? { category } : {}),
    ...(identity.buyer_type && identity.buyer_type !== saved.buyer_type
      ? { buyer_type: identity.buyer_type }
      : {}),
    ...(identity.market_scope && identity.market_scope !== saved.market_scope
      ? { market_scope: identity.market_scope }
      : {}),
  };
}

const sameOffering = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The offerings with a typed but not yet added entry appended, so Save never drops it. */
function withPending(offerings: readonly string[], pending: string): string[] {
  const value = pending.trim();
  return value && !offerings.some((item) => sameOffering(item, value))
    ? [...offerings, value]
    : [...offerings];
}

export function BrandProfilePanel({
  projectId,
  profile,
  competitors = [],
  competitorSuggestions,
  brandFacts,
  onSaved,
  header: Header = SaveRow,
}: Readonly<{
  projectId: string;
  profile: BrandProfile;
  competitors?: readonly TrackedCompetitor[];
  competitorSuggestions?: ReactNode;
  /** The fact-checking pilot's Brand facts, as their own tab; omitted outside the pilot. */
  brandFacts?: ReactNode;
  onSaved?: () => void;
  /**
   * Places the save action, normally in the section header beside its title.
   * The action keeps its box on the Business map and Brand facts tabs (which
   * save on their own), so switching tabs never moves the layout.
   */
  header?: ComponentType<{ actions: ReactNode }>;
}>) {
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const [savedDraft, setSavedDraft] = useState(() => profileDraft(profile));
  const [draft, setDraft] = useState(savedDraft);
  const [savedIdentity, setSavedIdentity] = useState(() =>
    identityFacets(profile.business_context),
  );
  const [identity, setIdentity] = useState(savedIdentity);
  const [pendingOffering, setPendingOffering] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProfileTab>('facts');

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!workspaceId) throw new Error('Workspace is not available.');
      return projectsApi.updateBrandProfile(
        projectId,
        {
          ...profileUpdate(
            { ...draft, products_services: withPending(draft.products_services, pendingOffering) },
            savedDraft,
          ),
          ...identityUpdate(identity, savedIdentity),
        },
        { workspaceId },
      );
    },
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.projects.brandProfile(projectId), next);
      onSaved?.();
      const nextDraft = profileDraft(next);
      setSavedDraft(nextDraft);
      setDraft(nextDraft);
      const nextIdentity = identityFacets(next.business_context);
      setSavedIdentity(nextIdentity);
      setIdentity(nextIdentity);
      setPendingOffering('');
      setNotice('Brand knowledge saved. These details now inform assisted features.');
    },
  });

  return (
    <Stack gap="workspace">
      <Header
        actions={
          <Button
            variant="primary"
            className={SELF_SAVING_TABS.has(activeTab) ? 'invisible' : undefined}
            onClick={() => saveMutation.mutate()}
            disabled={!workspaceId || saveMutation.isPending}
          >
            <Icon icon={Save} />
            {saveMutation.isPending ? 'Saving…' : 'Save brand knowledge'}
          </Button>
        }
      />

      {saveMutation.error ? (
        <Alert tone="danger">{humanizeApiError(saveMutation.error).message}</Alert>
      ) : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        items={PROFILE_TABS.filter((tab) => tab.id !== 'brand-facts' || brandFacts).map((tab) => ({
          value: tab.id,
          label: tab.label,
        }))}
        ariaLabel="Company facts sections"
        spaced
      >
        <TabPanel value={activeTab} className="focus-ring">
          {activeTab === 'map' ? (
            <BusinessMapTab projectId={projectId} workspaceId={workspaceId} profile={profile} />
          ) : null}
          {activeTab === 'brand-facts' ? brandFacts : null}
          {SELF_SAVING_TABS.has(activeTab) ? null : (
            <ProfileTabPanel
              activeTab={activeTab}
              draft={draft}
              identity={identity}
              pendingOffering={pendingOffering}
              disabled={saveMutation.isPending}
              competitors={competitors}
              competitorSuggestions={competitorSuggestions}
              onDraftChange={setDraft}
              onIdentityChange={setIdentity}
              onPendingOfferingChange={setPendingOffering}
            />
          )}
        </TabPanel>
      </Tabs>
    </Stack>
  );
}

function ProfileTabPanel({
  activeTab,
  draft,
  identity,
  pendingOffering,
  disabled,
  competitors,
  competitorSuggestions,
  onDraftChange,
  onIdentityChange,
  onPendingOfferingChange,
}: Readonly<{
  activeTab: ProfileTab;
  draft: BrandProfileDraft;
  identity: IdentityFacets;
  pendingOffering: string;
  disabled: boolean;
  competitors: readonly TrackedCompetitor[];
  competitorSuggestions?: ReactNode;
  onDraftChange: (draft: BrandProfileDraft) => void;
  onIdentityChange: (identity: IdentityFacets) => void;
  onPendingOfferingChange: (value: string) => void;
}>) {
  if (activeTab === 'facts') {
    return (
      <Stack gap="workspace">
        <IdentityFields identity={identity} disabled={disabled} onChange={onIdentityChange} />
        <Field label="Description" hint="Core mission, value proposition, and brand summary.">
          {(field) => (
            <Textarea
              {...field}
              rows={6}
              disabled={disabled}
              value={draft.description}
              onChange={(event) => onDraftChange({ ...draft, description: event.target.value })}
            />
          )}
        </Field>
        <Field
          label="Positioning"
          hint="Include price tier, differentiation, and competitive segment."
        >
          {(field) => (
            <Textarea
              {...field}
              rows={6}
              disabled={disabled}
              value={draft.positioning}
              onChange={(event) => onDraftChange({ ...draft, positioning: event.target.value })}
            />
          )}
        </Field>
      </Stack>
    );
  }

  if (activeTab === 'audience') {
    return (
      <Stack gap="workspace">
        <Field
          label="Target audience"
          hint="Key demographics, customer personas, and ideal buyers."
        >
          {(field) => (
            <Textarea
              {...field}
              rows={6}
              disabled={disabled}
              value={draft.target_audience}
              onChange={(event) => onDraftChange({ ...draft, target_audience: event.target.value })}
            />
          )}
        </Field>
        <OfferingList
          offerings={draft.products_services}
          pending={pendingOffering}
          disabled={disabled}
          onChange={(products_services) => onDraftChange({ ...draft, products_services })}
          onPendingChange={onPendingOfferingChange}
        />
      </Stack>
    );
  }

  return (
    <Stack gap="workspace">
      <Stack as="section" gap="compact" aria-labelledby="tracked-competitors">
        <h3 id="tracked-competitors" className={textRole('itemTitle')}>
          Tracked competitors
        </h3>
        {competitors.length ? (
          <Stack as="ul" gap="compact" className="desktop:grid-cols-2">
            {competitors.map((competitor) => (
              <Inline
                as="li"
                key={`${competitor.name}:${competitor.domains[0] ?? ''}`}
                className={panelClasses({ tone: 'well' }, textRole('label'))}
              >
                <BrandLogo
                  name={competitor.name}
                  logoUrl={competitor.logo_url}
                  websiteUrl={competitor.domains[0]}
                />
                <span className="truncate">{competitor.name}</span>
              </Inline>
            ))}
          </Stack>
        ) : (
          <UnavailableValue state="not_set" />
        )}
      </Stack>
      {competitorSuggestions}
    </Stack>
  );
}

/**
 * Category, buyer type and market scope decide which questions prompt
 * generation asks, so a wrong onboarding answer must stay correctable here.
 */
function IdentityFields({
  identity,
  disabled,
  onChange,
}: Readonly<{
  identity: IdentityFacets;
  disabled: boolean;
  onChange: (identity: IdentityFacets) => void;
}>) {
  return (
    <>
      <Field
        label="What you sell"
        hint="The category buyers would search for. Generated questions are built from it."
      >
        {(field) => (
          <Input
            {...field}
            disabled={disabled}
            value={identity.category}
            onChange={(event) => onChange({ ...identity, category: event.target.value })}
          />
        )}
      </Field>
      <div className={splitPaneClasses('peers')}>
        <FacetChoice
          label="Who buys it"
          value={identity.buyer_type}
          options={BUYER_TYPE_CHOICES}
          disabled={disabled}
          onPick={(buyer_type) => onChange({ ...identity, buyer_type })}
        />
        <FacetChoice
          label="Where they buy it"
          value={identity.market_scope}
          options={MARKET_SCOPE_CHOICES}
          disabled={disabled}
          onPick={(market_scope) => onChange({ ...identity, market_scope })}
        />
      </div>
    </>
  );
}

function FacetChoice<T extends string>({
  label,
  value,
  options,
  disabled,
  onPick,
}: Readonly<{
  label: string;
  value: T | null;
  options: readonly { value: T; label: string }[];
  disabled: boolean;
  onPick: (value: T) => void;
}>) {
  return (
    <Stack gap="compact">
      <span className={textRole('label')} aria-hidden>
        {label}
      </span>
      <RadioGroup<T | ''>
        variant="chip"
        ariaLabel={label}
        value={value ?? ''}
        options={options}
        onValueChange={(next) => {
          if (next && !disabled) onPick(next);
        }}
      />
    </Stack>
  );
}

/**
 * One offering per entry, so an offering whose name contains a comma
 * ("simulator bays for golf courses, and community centres") stays one offering.
 * A typed but unadded entry is held by the panel and saved with the list.
 */
function OfferingList({
  offerings,
  pending,
  disabled,
  onChange,
  onPendingChange,
}: Readonly<{
  offerings: readonly string[];
  pending: string;
  disabled: boolean;
  onChange: (offerings: string[]) => void;
  onPendingChange: (value: string) => void;
}>) {
  const label = 'Products and services';
  const hintId = useId();
  const trimmed = pending.trim();
  const canAdd = trimmed !== '' && !offerings.some((item) => sameOffering(item, trimmed));
  const add = () => {
    if (!canAdd) return;
    onChange([...offerings, trimmed]);
    onPendingChange('');
  };
  return (
    <Stack gap="compact">
      <span className={textRole('label')}>{label}</span>
      {offerings.length ? (
        <Stack as="ul" gap="tight" aria-label={label}>
          {offerings.map((offering) => (
            <Inline as="li" key={offering} className="type-body text-foreground">
              <span>{offering}</span>
              <IconButton
                icon={X}
                label={`Remove ${offering}`}
                disabled={disabled}
                onClick={() => onChange(offerings.filter((item) => item !== offering))}
              />
            </Inline>
          ))}
        </Stack>
      ) : null}
      <Inline>
        <Input
          value={pending}
          aria-label={`Add to ${label}`}
          aria-describedby={hintId}
          disabled={disabled}
          onChange={(event) => onPendingChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button variant="secondary" onClick={add} disabled={disabled || !canAdd}>
          <Icon icon={Plus} />
          Add
        </Button>
      </Inline>
      <span id={hintId} className="type-caption">
        One offering per entry, named as a buyer would.
      </span>
    </Stack>
  );
}

function BusinessMapTab({
  projectId,
  workspaceId,
  profile,
}: Readonly<{
  projectId: string;
  workspaceId: string | null | undefined;
  profile: BrandProfile;
}>) {
  if (!workspaceId) return <Alert tone="info">Workspace is not available.</Alert>;
  return <BusinessMapSummary projectId={projectId} workspaceId={workspaceId} profile={profile} />;
}

function SaveRow({ actions }: Readonly<{ actions: ReactNode }>) {
  return <div className="flex justify-end">{actions}</div>;
}
