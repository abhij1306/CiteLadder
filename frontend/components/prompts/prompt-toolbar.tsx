'use client';

import { ChevronDown, Plus, Sparkles, Upload } from 'lucide-react';
import type { ReactNode } from 'react';

import { LaunchAuditButton } from '@/components/runs/launch-audit-button';
import { Button } from '@/components/ui/button';
import { FilterTrigger, type FilterBarProps } from '@/components/ui/filter-bar';
import { Icon } from '@/components/ui/icon';
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import { SearchField } from '@/components/ui/search-field';
import { SegmentedControl } from '@/components/ui/tabs';
import type { PromptStatus } from '@/lib/api/types';
import {
  buyerStageLabels,
  buyerStageValues,
  intentLabels,
  intentValues,
} from '@/lib/prompts/forms';
import type { EnabledFilter, PromptFilters } from '@/lib/prompts/filter';

const PROMPT_STATUSES: readonly { value: PromptStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
];

/**
 * The prompt library's narrowing controls, on one row: the Active / Archived
 * status, a search box, the Topic filter and the intent / enabled / branded
 * filter menu. For the `ListScreen` control band.
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
  status,
  search,
  onSearchChange,
  filters,
  onFiltersChange,
  personas = [],
  topic,
}: Readonly<{
  /** Active / Archived, with the number of prompts in each. */
  status: Readonly<{
    value: PromptStatus;
    counts: Readonly<Record<PromptStatus, number>>;
    onChange: (value: PromptStatus) => void;
  }>;
  search: string;
  onSearchChange: (value: string) => void;
  filters: PromptFilters;
  onFiltersChange: (filters: PromptFilters) => void;
  /** The personas the library uses; the menu lists them when there are any. */
  personas?: readonly string[];
  /** The Topic filter (`TopicFilter`), first of the filters. */
  topic?: ReactNode;
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
    // The status leads the one control row and pushes search and the filter
    // menu to its end, so a count changing never moves them.
    view: (
      <SegmentedControl
        ariaLabel="Prompt status"
        value={status.value}
        onChange={status.onChange}
        options={PROMPT_STATUSES.map((option) => ({
          value: option.value,
          label: option.label,
          count: status.counts[option.value],
        }))}
      />
    ),
    search: (
      <SearchField
        value={search}
        onValueChange={onSearchChange}
        placeholder="Search prompts"
        aria-label="Search prompts"
      />
    ),
    filters: (
      <>
        {topic}
        <Menu>
          <MenuTrigger asChild>
            <FilterTrigger label="Filter" count={activeFilterCount} />
          </MenuTrigger>
          <MenuContent align="end">
            <MenuLabel>Intent</MenuLabel>
            {intentValues.map((value) => (
              <MenuCheckboxItem
                key={value || 'unspecified'}
                checked={selectedIntents.has(value)}
                onSelect={(event) => {
                  event.preventDefault();
                  toggleIntent(value);
                }}
              >
                {intentLabels[value]}
              </MenuCheckboxItem>
            ))}
            <MenuSeparator />
            <MenuLabel>Buyer stage</MenuLabel>
            {buyerStageValues.map((value) => (
              <MenuCheckboxItem
                key={value || 'unspecified'}
                checked={selectedStages.has(value)}
                onSelect={(event) => {
                  event.preventDefault();
                  toggleStage(value);
                }}
              >
                {buyerStageLabels[value]}
              </MenuCheckboxItem>
            ))}
            <MenuSeparator />
            {personas.length ? (
              <>
                <MenuLabel>Persona</MenuLabel>
                {personas.map((value) => (
                  <MenuCheckboxItem
                    key={value}
                    checked={selectedPersonas.has(value)}
                    onSelect={(event) => {
                      event.preventDefault();
                      toggle('personas', value);
                    }}
                  >
                    {value}
                  </MenuCheckboxItem>
                ))}
                <MenuSeparator />
              </>
            ) : null}
            <MenuLabel>Enabled</MenuLabel>
            {(['all', 'enabled', 'disabled'] as const).map((value) => (
              <MenuCheckboxItem
                key={value}
                checked={filters.enabled === value}
                onSelect={(event) => {
                  event.preventDefault();
                  setEnabled(value);
                }}
              >
                {ENABLED_FILTER_LABEL[value]}
              </MenuCheckboxItem>
            ))}
            <MenuSeparator />
            <MenuLabel>Branded</MenuLabel>
            {(['all', 'enabled', 'disabled'] as const).map((value) => (
              <MenuCheckboxItem
                key={value}
                checked={filters.branded === value}
                onSelect={(event) => {
                  event.preventDefault();
                  setBranded(value);
                }}
              >
                {BRANDED_FILTER_LABEL[value]}
              </MenuCheckboxItem>
            ))}
          </MenuContent>
        </Menu>
      </>
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
      <Menu>
        <MenuTrigger asChild>
          <Button variant="secondary">
            <Icon icon={Plus} />
            Add prompts
            <Icon icon={ChevronDown} className="opacity-80" />
          </Button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem icon={<Icon icon={Plus} />} onSelect={onAdd}>
            Add prompt
          </MenuItem>
          <MenuItem icon={<Icon icon={Sparkles} />} onSelect={onGenerate}>
            Prompt Builder
          </MenuItem>
          <MenuItem icon={<Icon icon={Upload} />} onSelect={onImport}>
            Bulk upload
          </MenuItem>
        </MenuContent>
      </Menu>
      <LaunchAuditButton variant="primary" disabled={!hasActivePrompts} />
    </>
  );
}
