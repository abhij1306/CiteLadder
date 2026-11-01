'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { ProjectLink } from '@/components/layout/scoped-link';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChipList } from '@/components/ui/chip-list-field';
import { FactList, type Fact } from '@/components/ui/facts';
import { Stack } from '@/components/ui/layout';
import { panelClasses } from '@/components/ui/panel';
import { QueryState } from '@/components/ui/query-state';
import { readErrorProps } from '@/components/ui/read-error';
import { textRole } from '@/components/ui/typography';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { projectsApi } from '@/lib/api/projects';
import { queryKeys } from '@/lib/api/query-keys';
import type { BrandProfile } from '@/lib/api/types';
import {
  businessDraft,
  showsServiceAreas,
  type MapEntryDraft,
} from '@/lib/prompts/builder-business';
import { BUSINESS_MODEL_CHOICES } from '@/lib/project/identity-facets';
import { PROMPTS_GENERATE_HREF } from '@/lib/prompts/routes';

const fieldSourcesSchema = z.record(z.string(), z.unknown());

/**
 * Whether a business-context field still holds what discovery inferred: only a
 * field a person has saved is `reviewed` in the context's `field_sources`.
 */
function inferredFields(profile: BrandProfile) {
  const parsed = fieldSourcesSchema.safeParse(profile.business_context.field_sources);
  const sources = parsed.success ? parsed.data : {};
  return (field: string) => sources[field] !== 'reviewed';
}

/** A list's values as chips; an inferred list reads as suggestions until a person saves it. */
const chips = (values: readonly string[], suggested: boolean) => (
  <ChipList items={values.map((value) => ({ value, suggested }))} />
);
/** A map's entries as chips; a suggestion says so until a person confirms it. */
const entryChips = (entries: readonly MapEntryDraft[]) => (
  <ChipList
    items={entries.map((entry) => ({
      value: entry.value,
      suggested: entry.review_state === 'suggested',
    }))}
  />
);
/** The saved business model's label; a saved value this app does not recognize stays distinct from none. */
function businessModelValue(profile: BrandProfile, suggested: boolean) {
  const saved = profile.business_context.business_model;
  const choice = BUSINESS_MODEL_CHOICES.find((option) => option.value === saved);
  if (choice) return <ChipList items={[{ value: choice.label, suggested }]} />;
  return <UnavailableValue state={saved == null || saved === '' ? 'not_set' : 'unknown'} />;
}

/**
 * The business facts that steer prompt generation, read-only on one card: the
 * Prompt Builder's first step owns editing them, and the card links there.
 * Each offering's map is a nested panel inside the card.
 */
export function BusinessMapSummary({
  projectId,
  workspaceId,
  profile,
}: Readonly<{ projectId: string; workspaceId: string; profile: BrandProfile }>) {
  return (
    <Card aria-labelledby="business-map">
      <CardHeader
        actions={
          <Button asChild variant="secondary">
            <ProjectLink href={PROMPTS_GENERATE_HREF}>Edit in Prompt Builder</ProjectLink>
          </Button>
        }
      >
        <CardTitle id="business-map">Business map</CardTitle>
        <CardDescription>
          These details steer prompt generation. Edit them in the Prompt Builder.
        </CardDescription>
      </CardHeader>
      <BusinessMapBody projectId={projectId} workspaceId={workspaceId} profile={profile} />
    </Card>
  );
}

function BusinessMapBody({
  projectId,
  workspaceId,
  profile,
}: Readonly<{ projectId: string; workspaceId: string; profile: BrandProfile }>) {
  const query = useQuery({
    queryKey: queryKeys.projects.businessMap(projectId),
    queryFn: ({ signal }) => projectsApi.getBusinessMap(projectId, { signal, workspaceId }),
  });
  if (query.isPending) return <QueryState kind="loading" label="Loading the business map" />;
  if (query.isError)
    return (
      <QueryState
        kind="error"
        {...readErrorProps(query)}
        fallback="The business map could not be loaded."
      />
    );
  const draft = businessDraft(profile, query.data);
  const inferred = inferredFields(profile);
  const facts: Fact[] = [
    { label: 'Buyer roles', value: chips(draft.buyerRoles, inferred('buyer_roles')) },
    ...(showsServiceAreas(profile.business_context)
      ? [
          {
            label: 'Service areas',
            value: chips(draft.serviceAreas, inferred('service_areas')),
          },
        ]
      : []),
    { label: 'Category terms', value: chips(draft.categoryTerms, inferred('category_terms')) },
    { label: 'Jobs to be done', value: chips(draft.jobs, inferred('jobs_to_be_done')) },
    {
      label: 'Business model',
      value: businessModelValue(profile, inferred('business_model')),
    },
  ];
  return (
    <Stack gap="workspace">
      <FactList layout="ruled" label="Business details" facts={facts} />
      {draft.maps.map((map) => (
        <Stack
          as="section"
          key={map.offering}
          aria-label={map.offering}
          gap="compact"
          className={panelClasses({ tone: 'tonal' })}
        >
          <h4 className={textRole('itemTitle')}>{map.offering}</h4>
          <FactList
            layout="ruled"
            facts={[
              { label: 'Who buys it', value: entryChips(map.audiences) },
              { label: 'Situations and constraints', value: entryChips(map.situations) },
              { label: 'Attributes', value: entryChips(map.attributes) },
            ]}
          />
        </Stack>
      ))}
    </Stack>
  );
}
