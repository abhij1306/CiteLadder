import { ChevronDown, Plus, Sparkles, Upload } from 'lucide-react';

import { LaunchAuditButton } from '@/components/runs/launch-audit-button';
import { Button } from '@/components/ui/button';
import { choiceFilter, manyFilter, type FilterDefinition } from '@/components/ui/all-filters';
import type { FilterBarProps } from '@/components/ui/filter-bar';
import { Icon } from '@/components/ui/icon';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { SearchField } from '@/components/ui/search-field';
import { SegmentedControl } from '@/components/ui/tabs';
import type { PromptStatus } from '@citeladder/contracts';
import { useWorkspaceCapability } from '@/lib/project/project-context';
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
 * The prompt library's control row (D57): the Active / Archived view, the
 * search, then every filter in All filters: Topic first, then Intent, Buyer
 * stage, Persona (when the library has any), Enabled and Branded.
 * Presentational; state lives in the page.
 */
/** The two single choices share a vocabulary but not their wording. */
const ENABLED_FILTER_LABEL: Record<EnabledFilter, string> = {
  all: 'All',
  enabled: 'Enabled only',
  disabled: 'Disabled only',
};

const BRANDED_FILTER_LABEL: Record<EnabledFilter, string> = {
  all: 'All',
  enabled: 'Branded only',
  disabled: 'Unbranded only',
};

const SINGLE_CHOICES = ['all', 'enabled', 'disabled'] as const;

function singleChoice(
  id: string,
  label: string,
  labels: Record<EnabledFilter, string>,
  value: EnabledFilter,
  onChange: (value: EnabledFilter) => void,
): FilterDefinition {
  return choiceFilter({
    id,
    label,
    value,
    defaultValue: 'all',
    groups: [
      { options: SINGLE_CHOICES.map((choice) => ({ value: choice, label: labels[choice] })) },
    ],
    onChange,
  });
}

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
  /** The Topic filter (`topicFilter`), first in All filters. */
  topic?: FilterDefinition;
}>): FilterBarProps {
  return {
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
    filters: [
      ...(topic ? [topic] : []),
      manyFilter({
        id: 'intent',
        label: 'Intent',
        allLabel: 'All intents',
        values: filters.intents,
        options: intentValues.map((value) => ({ value, label: intentLabels[value] })),
        onChange: (intents) => onFiltersChange({ ...filters, intents }),
      }),
      manyFilter({
        id: 'stage',
        label: 'Buyer stage',
        allLabel: 'All stages',
        values: filters.stages,
        options: buyerStageValues.map((value) => ({ value, label: buyerStageLabels[value] })),
        onChange: (stages) => onFiltersChange({ ...filters, stages }),
      }),
      ...(personas.length
        ? [
            manyFilter({
              id: 'persona',
              label: 'Persona',
              allLabel: 'All personas',
              values: filters.personas,
              options: personas.map((value) => ({ value, label: value })),
              onChange: (next) => onFiltersChange({ ...filters, personas: next }),
            }),
          ]
        : []),
      singleChoice('enabled', 'Enabled', ENABLED_FILTER_LABEL, filters.enabled, (enabled) =>
        onFiltersChange({ ...filters, enabled }),
      ),
      singleChoice('branded', 'Branded', BRANDED_FILTER_LABEL, filters.branded, (branded) =>
        onFiltersChange({ ...filters, branded }),
      ),
    ],
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
  // Each control is offered only to a role that may use it.
  const canWrite = useWorkspaceCapability('write');
  return (
    <>
      {canWrite ? (
        <AddPromptsMenu onImport={onImport} onAdd={onAdd} onGenerate={onGenerate} />
      ) : null}
      <LaunchAuditButton variant="primary" disabled={!hasActivePrompts} />
    </>
  );
}

function AddPromptsMenu({
  onImport,
  onAdd,
  onGenerate,
}: Readonly<{ onImport: () => void; onAdd: () => void; onGenerate: () => void }>) {
  return (
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
  );
}
