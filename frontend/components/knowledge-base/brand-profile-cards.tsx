'use client';

import { useState } from 'react';

import { ProjectEditPanel } from '@/components/projects/project-edit-panel';
import { Alert } from '@/components/ui/alert';
import { BrandLogo } from '@/components/ui/brand-logo';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChipList, ChipListField } from '@/components/ui/chip-list-field';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Stack } from '@/components/ui/layout';
import { RadioGroup } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { textRole } from '@/components/ui/typography';
import { splitPaneClasses } from '@/components/ui/workspace';
import { humanizeApiError } from '@/lib/api/errors';
import type { Project } from '@/lib/api/types';
import { BUYER_TYPE_CHOICES, MARKET_SCOPE_CHOICES } from '@/lib/project/identity-facets';
import { useWorkspaceCapability } from '@/lib/project/project-context';

import type { BrandProfileForm } from './use-brand-profile-form';

/** The profile save's outcome, above the tab it was saved from. */
export function ProfileSaveNotices({ form }: Readonly<{ form: BrandProfileForm }>) {
  if (form.error) return <Alert tone="danger">{humanizeApiError(form.error).message}</Alert>;
  return form.notice ? <Alert tone="success">{form.notice}</Alert> : null;
}

/**
 * Category, buyer type and market scope decide which questions prompt
 * generation asks, so a wrong onboarding answer must stay correctable here,
 * beside the description and positioning.
 */
export function CompanyFactsCard({ form }: Readonly<{ form: BrandProfileForm }>) {
  const { draft, identity, saving } = form;
  return (
    <Card aria-labelledby="company-facts">
      <CardHeader>
        <CardTitle id="company-facts">Company facts</CardTitle>
        <CardDescription>
          The canonical facts used across CiteLadder, including by the agent.
        </CardDescription>
      </CardHeader>
      <Stack gap="workspace">
        <Field
          label="What you sell"
          hint="The category buyers would search for. Generated questions are built from it."
        >
          {(field) => (
            <Input
              {...field}
              disabled={saving}
              value={identity.category}
              onChange={(event) => form.setIdentity({ ...identity, category: event.target.value })}
            />
          )}
        </Field>
        <div className={splitPaneClasses('peers')}>
          <FacetChoice
            label="Who buys it"
            value={identity.buyer_type}
            options={BUYER_TYPE_CHOICES}
            disabled={saving}
            onPick={(buyer_type) => form.setIdentity({ ...identity, buyer_type })}
          />
          <FacetChoice
            label="Where they buy it"
            value={identity.market_scope}
            options={MARKET_SCOPE_CHOICES}
            disabled={saving}
            onPick={(market_scope) => form.setIdentity({ ...identity, market_scope })}
          />
        </div>
        <Field label="Description" hint="Core mission, value proposition, and brand summary.">
          {(field) => (
            <Textarea
              {...field}
              rows={6}
              disabled={saving}
              value={draft.description}
              onChange={(event) => form.setDraft({ ...draft, description: event.target.value })}
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
              disabled={saving}
              value={draft.positioning}
              onChange={(event) => form.setDraft({ ...draft, positioning: event.target.value })}
            />
          )}
        </Field>
      </Stack>
    </Card>
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
 * Who the business sells to, and its offerings one chip each, so an offering
 * whose name holds a comma ("simulator bays for golf courses, and community
 * centres") stays one offering. A typed but unadded offering is held by the
 * form and saved with the list.
 */
export function AudienceCard({ form }: Readonly<{ form: BrandProfileForm }>) {
  const { draft, saving } = form;
  return (
    <Card aria-labelledby="audience-offerings">
      <CardHeader>
        <CardTitle id="audience-offerings">Audience and offerings</CardTitle>
        <CardDescription>Who you sell to, and what you sell.</CardDescription>
      </CardHeader>
      <Stack gap="workspace">
        <Field
          label="Target audience"
          hint="Key demographics, customer personas, and ideal buyers."
        >
          {(field) => (
            <Textarea
              {...field}
              rows={6}
              disabled={saving}
              value={draft.target_audience}
              onChange={(event) => form.setDraft({ ...draft, target_audience: event.target.value })}
            />
          )}
        </Field>
        <ChipListField
          label="Products and services"
          hint="One offering per entry, named as a buyer would."
          items={draft.products_services.map((value) => ({ value }))}
          onChange={(items) =>
            form.setDraft({ ...draft, products_services: items.map((item) => item.value) })
          }
          pending={form.pendingOffering}
          onPendingChange={form.setPendingOffering}
          disabled={saving}
        />
      </Stack>
    </Card>
  );
}

/**
 * The project's tracked competitors as one wrapping row of marked chips. They
 * are edited with the rest of the project's configuration, which this opens.
 */
export function TrackedCompetitorsCard({ project }: Readonly<{ project: Project }>) {
  const mayEdit = useWorkspaceCapability('write');
  const [editing, setEditing] = useState(false);
  return (
    <Card aria-labelledby="tracked-competitors">
      <CardHeader
        actions={
          mayEdit ? (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit competitors
            </Button>
          ) : null
        }
      >
        <CardTitle id="tracked-competitors">Tracked competitors</CardTitle>
        <CardDescription>The brands CiteLadder measures you against.</CardDescription>
      </CardHeader>
      <ChipList
        label="Tracked competitors"
        items={(project.competitors ?? []).map((competitor) => ({
          key: `${competitor.name}:${competitor.domains[0] ?? ''}`,
          value: competitor.name,
          media: (
            <BrandLogo
              name={competitor.name}
              logoUrl={competitor.logo_url}
              websiteUrl={competitor.domains[0]}
            />
          ),
        }))}
      />
      {editing ? <ProjectEditPanel project={project} open onOpenChange={setEditing} /> : null}
    </Card>
  );
}
