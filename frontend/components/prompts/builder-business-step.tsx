'use client';

import { ChipInput, type ChipItem } from '@/components/ui/chip-input';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Stack } from '@/components/ui/layout';
import { panelClasses } from '@/components/ui/panel';
import { QueryState } from '@/components/ui/query-state';
import { Select } from '@/components/ui/select';
import { textRole } from '@/components/ui/typography';
import type { PromptFormLimits } from '@citeladder/contracts';
import {
  showsServiceAreas,
  withOfferings,
  type BusinessDraft,
  type MapEntryDraft,
} from '@/lib/prompts/builder-business';
import { BUSINESS_MODEL_CHOICES } from '@/lib/project/identity-facets';

import type { BuilderBusiness } from './use-builder-business';

/** The bounds the API enforces on this step's saves and the run note, from the prompt-set list. */
export type BusinessStepLimits = Pick<
  PromptFormLimits,
  'context_list_max_entries' | 'run_context_max_chars'
>;
const chips = (values: readonly string[]): ChipItem[] => values.map((value) => ({ value }));
const values = (items: readonly ChipItem[]) => items.map((item) => item.value);
const entryChips = (entries: readonly MapEntryDraft[]): ChipItem[] =>
  entries.map((entry) => ({ value: entry.value, suggested: entry.review_state === 'suggested' }));
const entries = (items: readonly ChipItem[]): MapEntryDraft[] =>
  items.map((item) => ({
    value: item.value,
    review_state: item.suggested ? 'suggested' : 'confirmed',
  }));

/** One offering's buyers, buying situations and attributes, from the business map. */
function OfferingFacts({
  map,
  disabled,
  listMax,
  onChange,
}: Readonly<{
  map: BusinessDraft['maps'][number];
  disabled: boolean;
  listMax: number;
  onChange: (map: BusinessDraft['maps'][number]) => void;
}>) {
  return (
    <Stack as="section" gap="workspace" className={panelClasses({ tone: 'well' })}>
      <h3 className={textRole('itemTitle')}>{map.offering}</h3>
      <ChipInput
        label="Who buys it"
        items={entryChips(map.audiences)}
        onChange={(items) => onChange({ ...map, audiences: entries(items) })}
        placeholder="e.g. beginner golfers"
        disabled={disabled}
        max={listMax}
      />
      <ChipInput
        label="Situations and constraints"
        items={entryChips(map.situations)}
        onChange={(items) => onChange({ ...map, situations: entries(items) })}
        placeholder="e.g. small back garden"
        disabled={disabled}
        max={listMax}
      />
      <ChipInput
        label="Attributes"
        items={entryChips(map.attributes)}
        onChange={(items) => onChange({ ...map, attributes: entries(items) })}
        placeholder="e.g. self-standing frame"
        disabled={disabled}
        max={listMax}
      />
    </Stack>
  );
}

/**
 * Step 1: what the business sells, who buys it and the situations that shape
 * a purchase, prefilled from saved brand knowledge. Edits save to the brand
 * profile and business map; the run note applies to this run only.
 */
export function BuilderBusinessStep({
  business,
  runContext,
  onRunContextChange,
  limits,
}: Readonly<{
  business: BuilderBusiness;
  runContext: string;
  onRunContextChange: (value: string) => void;
  limits: BusinessStepLimits;
}>) {
  const listMax = limits.context_list_max_entries;
  const { draft, profile, map } = business;
  if (business.loading) return <QueryState kind="loading" label="Loading your business details" />;
  if (business.loadError || !draft || !profile || !map)
    return (
      <QueryState
        kind="error"
        error={business.loadError}
        fallback="Your business details could not be loaded."
        onRetry={business.retry}
        pending={business.retrying}
      />
    );
  const disabled = business.save.isPending;
  const set = (next: Partial<BusinessDraft>) => business.setDraft({ ...draft, ...next });
  return (
    <Stack gap="section">
      <ChipInput
        label="What you sell"
        hint="One offering per entry, named as a buyer would."
        items={chips(draft.offerings)}
        onChange={(items) => business.setDraft(withOfferings(draft, values(items), map))}
        placeholder="e.g. golf practice nets"
        disabled={disabled}
      />
      <ChipInput
        label="Buyer roles"
        hint="Who decides or pays, across everything you sell."
        items={chips(draft.buyerRoles)}
        onChange={(items) => set({ buyerRoles: values(items) })}
        placeholder="e.g. club coach"
        disabled={disabled}
        max={listMax}
      />
      {draft.maps.map((offering, index) => (
        <OfferingFacts
          key={offering.offering}
          map={offering}
          disabled={disabled}
          listMax={listMax}
          onChange={(next) =>
            set({ maps: draft.maps.map((item, i) => (i === index ? next : item)) })
          }
        />
      ))}
      {showsServiceAreas(profile.business_context) ? (
        <ChipInput
          label="Service areas"
          hint="Places you serve; prompts name them only for a local or regional business."
          items={chips(draft.serviceAreas)}
          onChange={(items) => set({ serviceAreas: values(items) })}
          placeholder="e.g. Leeds"
          disabled={disabled}
          max={listMax}
        />
      ) : null}
      <ChipInput
        label="Category terms"
        hint="Words buyers use for what you sell, never a product-line name."
        items={chips(draft.categoryTerms)}
        onChange={(items) => set({ categoryTerms: values(items) })}
        placeholder="e.g. golf net"
        disabled={disabled}
        max={listMax}
      />
      <ChipInput
        label="Jobs to be done"
        hint="What buyers are trying to get done."
        items={chips(draft.jobs)}
        onChange={(items) => set({ jobs: values(items) })}
        placeholder="e.g. practise driving at home"
        disabled={disabled}
        max={listMax}
      />
      <Field label="Business model">
        {(field) => (
          <Select
            id={field.id}
            ariaLabel="Business model"
            placeholder="Not set"
            value={draft.businessModel ?? undefined}
            options={BUSINESS_MODEL_CHOICES}
            disabled={disabled}
            onValueChange={(businessModel) => set({ businessModel })}
          />
        )}
      </Field>
      <Field
        label="Anything else for this run"
        hint="Applies to this run only; it is never saved as a business fact."
      >
        {(field) => (
          <Input
            {...field}
            value={runContext}
            maxLength={limits.run_context_max_chars}
            placeholder="e.g. focus on winter practice"
            onChange={(event) => onRunContextChange(event.target.value)}
          />
        )}
      </Field>
    </Stack>
  );
}
