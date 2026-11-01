'use client';

import { useQuery } from '@tanstack/react-query';

import { ProjectLink } from '@/components/layout/scoped-link';
import { Button } from '@/components/ui/button';
import { FactList, type Fact } from '@/components/ui/facts';
import { Inline, Stack } from '@/components/ui/layout';
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

/** A list as one line of text; a suggestion says so until a person confirms it. */
function listValue(values: readonly string[]) {
  return values.length ? values.join(', ') : <UnavailableValue state="not_set" />;
}
/** The saved business model's label; a saved value this app does not recognize stays distinct from none. */
function businessModelValue(profile: BrandProfile) {
  const saved = profile.business_context.business_model;
  const choice = BUSINESS_MODEL_CHOICES.find((option) => option.value === saved);
  if (choice) return choice.label;
  return <UnavailableValue state={saved == null || saved === '' ? 'not_set' : 'unknown'} />;
}
const entryValues = (entries: readonly MapEntryDraft[]) =>
  entries.map((entry) =>
    entry.review_state === 'suggested' ? `${entry.value} (suggested)` : entry.value,
  );

/**
 * The business facts that steer prompt generation, read-only: the Prompt
 * Builder's first step owns editing them, and this links there.
 */
export function BusinessMapSummary({
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
  const facts: Fact[] = [
    { label: 'Buyer roles', value: listValue(draft.buyerRoles) },
    ...(showsServiceAreas(profile.business_context)
      ? [{ label: 'Service areas', value: listValue(draft.serviceAreas) }]
      : []),
    { label: 'Category terms', value: listValue(draft.categoryTerms) },
    { label: 'Jobs to be done', value: listValue(draft.jobs) },
    { label: 'Business model', value: businessModelValue(profile) },
  ];
  return (
    <Stack gap="workspace">
      <Inline className="flex-wrap justify-between">
        <p className={textRole('body', 'text-secondary')}>
          These details steer prompt generation. Edit them in the Prompt Builder.
        </p>
        <Button asChild variant="secondary">
          <ProjectLink href={PROMPTS_GENERATE_HREF}>Edit in Prompt Builder</ProjectLink>
        </Button>
      </Inline>
      <FactList layout="ruled" label="Business details" facts={facts} />
      {draft.maps.map((map) => (
        <Stack
          as="section"
          key={map.offering}
          aria-label={map.offering}
          gap="compact"
          className={panelClasses({ tone: 'well' })}
        >
          <h3 className={textRole('itemTitle')}>{map.offering}</h3>
          <FactList
            layout="ruled"
            facts={[
              { label: 'Who buys it', value: listValue(entryValues(map.audiences)) },
              {
                label: 'Situations and constraints',
                value: listValue(entryValues(map.situations)),
              },
              { label: 'Attributes', value: listValue(entryValues(map.attributes)) },
            ]}
          />
        </Stack>
      ))}
    </Stack>
  );
}
