'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useState, type ComponentType, type ReactNode } from 'react';

import { Alert } from '@/components/ui/alert';
import { BrandLogo } from '@/components/ui/brand-logo';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Stack } from '@/components/ui/layout';
import { panelClasses } from '@/components/ui/panel';
import { RadioGroup } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { UnavailableValue } from '@/components/ui/unavailable-value';
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

import { BusinessMapEditor } from './business-map-editor';

const PROFILE_TABS = [
  { id: 'facts', label: 'Facts & Positioning' },
  { id: 'audience', label: 'Audience & Offerings' },
  { id: 'map', label: 'Business map' },
  { id: 'competitors', label: 'Competitors' },
] as const;

type ProfileTab = (typeof PROFILE_TABS)[number]['id'];
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

function parseProductsInput(value: string): string[] {
  return value.split(',').flatMap((item) => {
    const trimmed = item.trim();
    return trimmed ? [trimmed] : [];
  });
}

export function BrandProfilePanel({
  projectId,
  profile,
  competitors = [],
  competitorSuggestions,
  onSaved,
  header: Header = SaveRow,
}: Readonly<{
  projectId: string;
  profile: BrandProfile;
  competitors?: readonly TrackedCompetitor[];
  competitorSuggestions?: ReactNode;
  onSaved?: () => void;
  /**
   * Places the save action, normally in the section header beside its title.
   * The action keeps its box on the Business map tab (which saves on its own),
   * so switching tabs never moves the layout.
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
  const [productsInput, setProductsInput] = useState(() => profile.products_services.join(', '));
  const [notice, setNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProfileTab>('facts');

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!workspaceId) throw new Error('Workspace is not available.');
      return projectsApi.updateBrandProfile(
        projectId,
        {
          ...profileUpdate(
            { ...draft, products_services: parseProductsInput(productsInput) },
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
      setProductsInput(next.products_services.join(', '));
      setNotice('Brand knowledge saved. These details now inform assisted features.');
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <Header
        actions={
          <Button
            variant="primary"
            className={activeTab === 'map' ? 'invisible' : undefined}
            onClick={() => saveMutation.mutate()}
            disabled={!workspaceId || saveMutation.isPending}
          >
            <Save className="size-4" aria-hidden />
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
        items={PROFILE_TABS.map((tab) => ({ value: tab.id, label: tab.label }))}
        ariaLabel="Company facts sections"
        rootClassName="grid gap-4"
      >
        <TabPanel value={activeTab} className="focus-ring">
          {activeTab === 'map' ? (
            <BusinessMapTab projectId={projectId} workspaceId={workspaceId} />
          ) : (
            <ProfileTabPanel
              activeTab={activeTab}
              draft={draft}
              identity={identity}
              productsInput={productsInput}
              disabled={saveMutation.isPending}
              competitors={competitors}
              competitorSuggestions={competitorSuggestions}
              onDraftChange={setDraft}
              onIdentityChange={setIdentity}
              onProductsChange={setProductsInput}
            />
          )}
        </TabPanel>
      </Tabs>
    </div>
  );
}

function ProfileTabPanel({
  activeTab,
  draft,
  identity,
  productsInput,
  disabled,
  competitors,
  competitorSuggestions,
  onDraftChange,
  onIdentityChange,
  onProductsChange,
}: Readonly<{
  activeTab: ProfileTab;
  draft: BrandProfileDraft;
  identity: IdentityFacets;
  productsInput: string;
  disabled: boolean;
  competitors: readonly TrackedCompetitor[];
  competitorSuggestions?: ReactNode;
  onDraftChange: (draft: BrandProfileDraft) => void;
  onIdentityChange: (identity: IdentityFacets) => void;
  onProductsChange: (value: string) => void;
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
        <Field label="Products and services" hint="Comma-separated category labels.">
          {(field) => (
            <Textarea
              {...field}
              rows={6}
              disabled={disabled}
              value={productsInput}
              onChange={(event) => onProductsChange(event.target.value)}
            />
          )}
        </Field>
      </Stack>
    );
  }

  return (
    <Stack gap="workspace">
      <section aria-labelledby="tracked-competitors" className="grid gap-2">
        <h3 id="tracked-competitors" className={textRole('itemTitle')}>
          Tracked competitors
        </h3>
        {competitors.length ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {competitors.map((competitor) => (
              <li
                key={`${competitor.name}:${competitor.domains[0] ?? ''}`}
                className={panelClasses(
                  { tone: 'well', pad: 'none' },
                  textRole('label', 'flex min-w-0 items-center gap-2 px-3 py-2'),
                )}
              >
                <BrandLogo
                  name={competitor.name}
                  logoUrl={competitor.logo_url}
                  websiteUrl={competitor.domains[0]}
                  size="sm"
                />
                <span className="truncate">{competitor.name}</span>
              </li>
            ))}
          </ul>
        ) : (
          <UnavailableValue state="not_set" />
        )}
      </section>
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
      <div className="grid gap-4 sm:grid-cols-2">
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
    <div className="grid gap-2">
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
    </div>
  );
}

function BusinessMapTab({
  projectId,
  workspaceId,
}: Readonly<{ projectId: string; workspaceId: string | null | undefined }>) {
  if (!workspaceId) return <Alert tone="info">Workspace is not available.</Alert>;
  return <BusinessMapEditor projectId={projectId} workspaceId={workspaceId} />;
}

function SaveRow({ actions }: Readonly<{ actions: ReactNode }>) {
  return <div className="flex justify-end">{actions}</div>;
}
