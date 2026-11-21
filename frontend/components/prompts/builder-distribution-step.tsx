import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Stack } from '@/components/ui/layout';
import { SettingField, SettingRows, SettingsGroup } from '@/components/ui/setting-row';
import { SplitBar } from '@/components/ui/split-bar';
import { StateBlock } from '@/components/ui/state-block';
import { SegmentedControl } from '@/components/ui/tabs';
import { textRole } from '@/components/ui/typography';
import type { PromptFormLimits, SeedQueries, Topic } from '@citeladder/contracts';
import { Search, Users } from '@/lib/icons';
import { PROMPT_BUILDER } from '@/lib/config/prompts';
import { formatCount } from '@/lib/format';
import {
  INTENT_KEYS,
  seedSourceOf,
  type RunSettings,
  type SeedChoice,
} from '@/lib/prompts/builder-run';

const INTENT_SEGMENTS = [
  { key: 'informational', label: 'Informational' },
  { key: 'commercial', label: 'Commercial' },
  { key: 'transactional', label: 'Transactional' },
] as const satisfies readonly { key: (typeof INTENT_KEYS)[number]; label: string }[];
const SHARE_SEGMENTS = [
  { key: 'unbranded', label: 'Unbranded' },
  { key: 'branded', label: 'Branded' },
  { key: 'comparison', label: 'Competitor alternatives' },
] as const;
const SOURCE_LABELS: Record<SeedChoice, string> = {
  search_console: 'Search Console',
  search_intelligence: 'Keyword research',
  none: 'None',
};

const share = (text: string) => {
  const value = Math.round(Number(text));
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
};

function ShareMix({
  settings,
  onChange,
  hasCompetitors,
}: Readonly<{
  settings: RunSettings;
  onChange: (settings: RunSettings) => void;
  hasCompetitors: boolean;
}>) {
  const branded = share(settings.brandedPercent);
  const comparison = hasCompetitors
    ? Math.min(share(settings.comparisonPercent), 100 - branded)
    : 0;
  const segments = hasCompetitors ? SHARE_SEGMENTS : SHARE_SEGMENTS.slice(0, 2);
  const values = [100 - branded - comparison, branded, comparison].slice(0, segments.length);
  return (
    <SplitBar
      label="Branded share"
      segments={segments}
      values={values}
      onChange={([, nextBranded = 0, nextComparison = 0]) =>
        onChange({
          ...settings,
          brandedPercent: String(nextBranded),
          comparisonPercent: String(nextComparison),
        })
      }
    />
  );
}

function PersonaChoices({
  choices,
  selected,
  max,
  onChange,
}: Readonly<{
  choices: readonly string[];
  selected: readonly string[];
  max: number;
  onChange: (personas: string[]) => void;
}>) {
  if (!choices.length)
    return (
      <StateBlock
        kind="empty"
        inline
        icon={Users}
        message="Add buyer roles or audiences in step 1 to balance across personas."
      />
    );
  const full = selected.length >= max;
  return (
    <SettingRows label="Personas">
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
    </SettingRows>
  );
}

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
      <StateBlock
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
    <SettingRows label="Search queries">
      {topics.flatMap((topic) => {
        const own = queries.filter((query) => query.topic_id === topic.id);
        if (!own.length) return [];
        const kept = own.filter((query) => !settings.unticked.has(query.id)).length;
        return [
          <Stack key={topic.id} as="fieldset" gap="tight">
            <legend className={textRole('label', 'flex w-full justify-between gap-2 pb-1')}>
              {topic.name}
              <span className={textRole('caption', 'tabular-nums')}>
                {`${formatCount(kept)} of ${formatCount(own.length)}`}
              </span>
            </legend>
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
    </SettingRows>
  );
}

export function BuilderDistributionStep({
  settings,
  onChange,
  hasCompetitors,
  personaChoices,
  seeds,
  topics,
  notices,
  limits,
}: Readonly<{
  limits: Pick<PromptFormLimits, 'generation_count_max' | 'distribution_personas_max'>;
  settings: RunSettings;
  onChange: (settings: RunSettings) => void;
  hasCompetitors: boolean;
  personaChoices: readonly string[];
  seeds: { data?: SeedQueries; status: ReactNode };
  topics: readonly Topic[];
  notices: ReactNode;
}>) {
  const sources: SeedChoice[] = [...(seeds.data?.sources.map((item) => item.source) ?? []), 'none'];
  const intent = INTENT_SEGMENTS.map((segment) => share(settings.intent[segment.key]));
  const mix = PROMPT_BUILDER.defaultIntentMix;
  const resetIntent = () =>
    onChange({
      ...settings,
      intent: {
        informational: String(mix.informational),
        commercial: String(mix.commercial),
        transactional: String(mix.transactional),
      },
    });
  return (
    <Stack gap="section" className="max-w-[var(--container-prose)]">
      {notices}
      <SettingsGroup title="Size and share">
        <SettingRows>
          <SettingField inline label="Number of prompts" hint={`1–${limits.generation_count_max}`}>
            {(field) => (
              <Input
                {...field}
                type="number"
                inputMode="numeric"
                min={1}
                max={limits.generation_count_max}
                width="quantity"
                value={settings.count}
                onChange={(event) => onChange({ ...settings, count: event.target.value })}
              />
            )}
          </SettingField>
          <ShareMix settings={settings} onChange={onChange} hasCompetitors={hasCompetitors} />
        </SettingRows>
      </SettingsGroup>
      <SettingsGroup
        title="Intent mix"
        action={
          <Button variant="quiet" onClick={resetIntent}>
            Reset
          </Button>
        }
      >
        <SettingRows>
          <SplitBar
            label="Intent mix"
            segments={INTENT_SEGMENTS}
            values={intent}
            onChange={([informational = 0, commercial = 0, transactional = 0]) =>
              onChange({
                ...settings,
                intent: {
                  informational: String(informational),
                  commercial: String(commercial),
                  transactional: String(transactional),
                },
              })
            }
          />
        </SettingRows>
      </SettingsGroup>
      <SettingsGroup
        title="Personas"
        status={
          <span className={textRole('caption', 'tabular-nums')}>
            {`${formatCount(settings.personas.length)} of ${formatCount(limits.distribution_personas_max)}`}
          </span>
        }
      >
        <PersonaChoices
          choices={personaChoices}
          selected={settings.personas}
          max={limits.distribution_personas_max}
          onChange={(personas) => onChange({ ...settings, personas })}
        />
      </SettingsGroup>
      <SettingsGroup title="Search data">
        {seeds.data ? (
          <Stack gap="compact">
            <SegmentedControl<SeedChoice>
              ariaLabel="Search data source"
              value={seedSourceOf(settings, seeds.data)}
              options={sources.map((source) => ({ value: source, label: SOURCE_LABELS[source] }))}
              onChange={(seedSource) => onChange({ ...settings, seedSource, unticked: new Set() })}
            />
            <SeedList seeds={seeds.data} settings={settings} topics={topics} onChange={onChange} />
          </Stack>
        ) : (
          seeds.status
        )}
      </SettingsGroup>
    </Stack>
  );
}
