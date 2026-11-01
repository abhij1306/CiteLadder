'use client';

import { Search, Users } from 'lucide-react';
import type { ReactNode } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { RadioGroup } from '@/components/ui/radio-group';
import { textRole } from '@/components/ui/typography';
import { splitPaneClasses } from '@/components/ui/workspace';
import type { SeedQueries, Topic } from '@/lib/api/types';
import { MAX_GENERATION_COUNT, PROMPT_BUILDER } from '@/lib/config/prompts';
import {
  INTENT_KEYS,
  seedSourceOf,
  type RunSettings,
  type SeedChoice,
} from '@/lib/prompts/builder-run';

const INTENT_LABELS = {
  informational: 'Informational',
  commercial: 'Commercial',
  transactional: 'Transactional',
} as const satisfies Record<(typeof INTENT_KEYS)[number], string>;
const SOURCE_LABELS: Record<SeedChoice, string> = {
  search_console: 'Search Console',
  search_intelligence: 'Search Intelligence',
  none: 'None',
};

function Section({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <Stack as="fieldset" gap="compact" className="min-w-0">
      <legend className={textRole('label')}>{title}</legend>
      {children}
    </Stack>
  );
}

function PercentField({
  label,
  hint,
  value,
  disabled,
  onChange,
}: Readonly<{
  label: string;
  hint: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}>) {
  return (
    <Field label={label} hint={hint}>
      {(field) => (
        <Input
          {...field}
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          width="quantity"
          value={value}
          disabled={disabled}
          endContent="%"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/** The person's personas to balance across; at most the API's limit may be chosen. */
function PersonaChoices({
  choices,
  selected,
  onChange,
}: Readonly<{
  choices: readonly string[];
  selected: readonly string[];
  onChange: (personas: string[]) => void;
}>) {
  if (!choices.length)
    return (
      <QueryState
        kind="empty"
        inline
        icon={Users}
        message="Add buyer roles or audiences in step 1 to balance across personas."
      />
    );
  const full = selected.length >= PROMPT_BUILDER.personasMax;
  return (
    <Stack gap="tight">
      {choices.map((persona) => {
        const checked = selected.includes(persona);
        return (
          <Checkbox
            key={persona}
            label={persona}
            checked={checked}
            disabled={!checked && full}
            onCheckedChange={(next) =>
              onChange(
                next === true ? [...selected, persona] : selected.filter((p) => p !== persona),
              )
            }
          />
        );
      })}
      <span className="type-caption">
        None chosen balances across the audiences each topic&apos;s offerings name. Up to{' '}
        {PROMPT_BUILDER.personasMax}.
      </span>
    </Stack>
  );
}

/** The chosen source's queries by topic, each untickable; seeds steer wording only. */
function SeedList({
  seeds,
  settings,
  topics,
  onChange,
}: Readonly<{
  seeds: SeedQueries;
  settings: RunSettings;
  topics: readonly Topic[];
  onChange: (settings: RunSettings) => void;
}>) {
  const source = seedSourceOf(settings, seeds);
  if (source === 'none') return null;
  const queries = seeds.sources.find((item) => item.source === source)?.queries ?? [];
  if (!queries.length)
    return (
      <QueryState
        kind="empty"
        inline
        icon={Search}
        message={`No question-like ${SOURCE_LABELS[source]} searches match your topics yet.`}
      />
    );
  const toggle = (id: string, ticked: boolean) => {
    const unticked = new Set(settings.unticked);
    if (ticked) unticked.delete(id);
    else unticked.add(id);
    onChange({ ...settings, unticked });
  };
  return (
    <Stack gap="compact">
      {topics.flatMap((topic) => {
        const own = queries.filter((query) => query.topic_id === topic.id);
        if (!own.length) return [];
        return [
          <Stack key={topic.id} as="fieldset" gap="tight">
            <legend className={textRole('label')}>{topic.name}</legend>
            {own.map((query) => (
              <Checkbox
                key={query.id}
                label={query.text}
                checked={!settings.unticked.has(query.id)}
                onCheckedChange={(next) => toggle(query.id, next === true)}
              />
            ))}
          </Stack>,
        ];
      })}
    </Stack>
  );
}

/**
 * Step 3: how the run divides. Every control starts at a default that suits
 * most businesses: 80% unbranded, intents 25/50/25, seeds from the first
 * connected search source.
 */
export function BuilderDistributionStep({
  settings,
  onChange,
  hasCompetitors,
  personaChoices,
  seeds,
  topics,
  notices,
}: Readonly<{
  settings: RunSettings;
  onChange: (settings: RunSettings) => void;
  hasCompetitors: boolean;
  personaChoices: readonly string[];
  /** The seed-query read: loading, failed or loaded. */
  seeds: { data?: SeedQueries; status: ReactNode };
  topics: readonly Topic[];
  /** Run state and unsaved-step warnings, above the controls. */
  notices: ReactNode;
}>) {
  const branded = Number(settings.brandedPercent);
  const sources: SeedChoice[] = [...(seeds.data?.sources.map((item) => item.source) ?? []), 'none'];
  return (
    <Stack gap="section">
      {notices}
      <Field label="Number of prompts" hint={`From 1 to ${MAX_GENERATION_COUNT}.`}>
        {(field) => (
          <Input
            {...field}
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_GENERATION_COUNT}
            width="quantity"
            value={settings.count}
            onChange={(event) => onChange({ ...settings, count: event.target.value })}
          />
        )}
      </Field>
      <div className={splitPaneClasses('peers')}>
        <PercentField
          label="Branded share"
          hint={
            Number.isFinite(branded)
              ? `${Math.max(0, 100 - branded)}% unbranded. Branded prompts name your brand.`
              : 'Branded prompts name your brand.'
          }
          value={settings.brandedPercent}
          onChange={(brandedPercent) => onChange({ ...settings, brandedPercent })}
        />
        <PercentField
          label="Competitor alternatives"
          hint={
            hasCompetitors
              ? 'Prompts asking for alternatives to a competitor.'
              : 'Not available until you track a competitor.'
          }
          value={hasCompetitors ? settings.comparisonPercent : '0'}
          disabled={!hasCompetitors}
          onChange={(comparisonPercent) => onChange({ ...settings, comparisonPercent })}
        />
      </div>
      <Section title="Intent mix">
        <div className={splitPaneClasses('thirds')}>
          {INTENT_KEYS.map((key) => (
            <PercentField
              key={key}
              label={INTENT_LABELS[key]}
              hint="Relative weight."
              value={settings.intent[key]}
              onChange={(value) =>
                onChange({ ...settings, intent: { ...settings.intent, [key]: value } })
              }
            />
          ))}
        </div>
      </Section>
      <Section title="Personas to balance across">
        <PersonaChoices
          choices={personaChoices}
          selected={settings.personas}
          onChange={(personas) => onChange({ ...settings, personas })}
        />
      </Section>
      <Section title="Search data">
        {seeds.data ? (
          <>
            <RadioGroup<SeedChoice>
              variant="chip"
              ariaLabel="Search data source"
              value={seedSourceOf(settings, seeds.data)}
              options={sources.map((source) => ({ value: source, label: SOURCE_LABELS[source] }))}
              onValueChange={(seedSource) =>
                onChange({ ...settings, seedSource, unticked: new Set() })
              }
            />
            <span className="type-caption">
              {sources.length > 1
                ? 'Searches steer wording only: a query is never copied into a prompt, and no search volume is shown as AI volume.'
                : 'No search data is connected. Connect Search Console or run Search Intelligence to ground wording in real searches.'}
            </span>
            <SeedList seeds={seeds.data} settings={settings} topics={topics} onChange={onChange} />
          </>
        ) : (
          seeds.status
        )}
      </Section>
    </Stack>
  );
}
