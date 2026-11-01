'use client';

import { ChevronDown, Plus, Sparkles, Upload } from 'lucide-react';

import { LaunchAuditButton } from '@/components/runs/launch-audit-button';
import { Button } from '@/components/ui/button';
import {
  Dropdown,
  DropdownCheckboxItem,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from '@/components/ui/dropdown';
import { FilterTrigger, type FilterBarProps } from '@/components/ui/filter-bar';
import { Icon } from '@/components/ui/icon';
import { SearchField } from '@/components/ui/search-field';
import {
  buyerStageLabels,
  buyerStageValues,
  intentLabels,
  intentValues,
} from '@/lib/prompts/forms';
import type { EnabledFilter, PromptFilters } from '@/lib/prompts/filter';

/**
 * The prompt library's narrowing controls: a search box and the intent /
 * enabled / branded filter menu. For the `ListScreen` control band.
 *
 * The bulk-upload, generate and add buttons used to sit on this same row.
 * They are not filters — they act on the library rather than narrowing it — so
 * they moved to the identity band with every other route action, and this is
 * what was left. Presentational; state lives in the page.
 */
/** The two filter menus share a vocabulary but not their wording. */
const ENABLED_FILTER_LABEL: Record<'all' | 'enabled' | 'disabled', string> = {
  all: 'All',
  enabled: 'Enabled only',
  disabled: 'Disabled only',
};

const BRANDED_FILTER_LABEL: Record<'all' | 'enabled' | 'disabled', string> = {
  all: 'All',
  enabled: 'Branded only',
  disabled: 'Unbranded only',
};

export function promptFilterControls({
  search,
  onSearchChange,
  filters,
  onFiltersChange,
  personas = [],
}: Readonly<{
  search: string;
  onSearchChange: (value: string) => void;
  filters: PromptFilters;
  onFiltersChange: (filters: PromptFilters) => void;
  /** The personas the library uses; the menu lists them when there are any. */
  personas?: readonly string[];
}>): FilterBarProps {
  const activeFilterCount =
    filters.intents.length +
    filters.stages.length +
    filters.personas.length +
    (filters.enabled === 'all' ? 0 : 1) +
    (filters.branded === 'all' ? 0 : 1);

  // Set lookups: `checked` is computed per option in the render loops.
  const selectedIntents = new Set(filters.intents);
  const selectedStages = new Set(filters.stages);
  const selectedPersonas = new Set(filters.personas);

  const toggle = (key: 'intents' | 'stages' | 'personas', value: string) => {
    const current = filters[key];
    const next = current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value];
    onFiltersChange({ ...filters, [key]: next });
  };
  const toggleIntent = (value: string) => toggle('intents', value);
  const toggleStage = (value: string) => toggle('stages', value);

  const setEnabled = (value: EnabledFilter) => onFiltersChange({ ...filters, enabled: value });
  const setBranded = (value: EnabledFilter) => onFiltersChange({ ...filters, branded: value });

  return {
    search: (
      <SearchField
        value={search}
        onValueChange={onSearchChange}
        placeholder="Search prompts"
        aria-label="Search prompts"
      />
    ),
    filters: (
      <Dropdown>
        <DropdownTrigger asChild>
          <FilterTrigger label="Filter" count={activeFilterCount} />
        </DropdownTrigger>
        <DropdownContent align="end" width="panel">
          <DropdownLabel>Intent</DropdownLabel>
          {intentValues.map((value) => (
            <DropdownCheckboxItem
              key={value || 'unspecified'}
              checked={selectedIntents.has(value)}
              onSelect={(event) => {
                event.preventDefault();
                toggleIntent(value);
              }}
            >
              {intentLabels[value]}
            </DropdownCheckboxItem>
          ))}
          <DropdownSeparator />
          <DropdownLabel>Buyer stage</DropdownLabel>
          {buyerStageValues.map((value) => (
            <DropdownCheckboxItem
              key={value || 'unspecified'}
              checked={selectedStages.has(value)}
              onSelect={(event) => {
                event.preventDefault();
                toggleStage(value);
              }}
            >
              {buyerStageLabels[value]}
            </DropdownCheckboxItem>
          ))}
          <DropdownSeparator />
          {personas.length ? (
            <>
              <DropdownLabel>Persona</DropdownLabel>
              {personas.map((value) => (
                <DropdownCheckboxItem
                  key={value}
                  checked={selectedPersonas.has(value)}
                  onSelect={(event) => {
                    event.preventDefault();
                    toggle('personas', value);
                  }}
                >
                  {value}
                </DropdownCheckboxItem>
              ))}
              <DropdownSeparator />
            </>
          ) : null}
          <DropdownLabel>Enabled</DropdownLabel>
          {(['all', 'enabled', 'disabled'] as const).map((value) => (
            <DropdownCheckboxItem
              key={value}
              checked={filters.enabled === value}
              onSelect={(event) => {
                event.preventDefault();
                setEnabled(value);
              }}
            >
              {ENABLED_FILTER_LABEL[value]}
            </DropdownCheckboxItem>
          ))}
          <DropdownSeparator />
          <DropdownLabel>Branded</DropdownLabel>
          {(['all', 'enabled', 'disabled'] as const).map((value) => (
            <DropdownCheckboxItem
              key={value}
              checked={filters.branded === value}
              onSelect={(event) => {
                event.preventDefault();
                setBranded(value);
              }}
            >
              {BRANDED_FILTER_LABEL[value]}
            </DropdownCheckboxItem>
          ))}
        </DropdownContent>
      </Dropdown>
    ),
  };
}

/**
 * The library's own actions, for the `ListScreen` identity band: the three ways to
 * add prompts share one menu, so the band holds one secondary and one primary
 * action at every width instead of wrapping five buttons over the title.
 */
export function PromptActions({
  onImport,
  onAdd,
  onGenerate,
  hasActivePrompts,
}: Readonly<{
  onImport: () => void;
  onAdd: () => void;
  onGenerate: () => void;
  /** Launch audit measures active prompts, so it waits for at least one. */
  hasActivePrompts: boolean;
}>) {
  return (
    <>
      <Dropdown>
        <DropdownTrigger asChild>
          <Button variant="secondary">
            <Icon icon={Plus} />
            Add prompts
            <Icon icon={ChevronDown} className="opacity-80" />
          </Button>
        </DropdownTrigger>
        <DropdownContent align="end" width="panel">
          <DropdownItem onSelect={onAdd}>
            <Icon icon={Plus} />
            Add prompt
          </DropdownItem>
          <DropdownItem onSelect={onGenerate}>
            <Icon icon={Sparkles} />
            Prompt Builder
          </DropdownItem>
          <DropdownItem onSelect={onImport}>
            <Icon icon={Upload} />
            Bulk upload
          </DropdownItem>
        </DropdownContent>
      </Dropdown>
      <LaunchAuditButton variant="primary" disabled={!hasActivePrompts} />
    </>
  );
}
