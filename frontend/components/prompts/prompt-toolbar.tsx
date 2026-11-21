import { LaunchAuditButton } from '@/components/runs/launch-audit-button';
import { ACTIONS } from '@/components/ui/actions';
import { Button } from '@/components/ui/button';
import { MastheadPrimary } from '@/components/ui/masthead-actions';
import {
  choiceFilter,
  manyFilter,
  type FilterDefinition,
  type FilterIcon,
} from '@/components/ui/all-filters';
import type { FilterBarProps } from '@/components/ui/filter-bar';
import { Icon } from '@/components/ui/icon';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { SearchField } from '@/components/ui/search-field';
import { TabRow } from '@/components/ui/tabs';
import type { PromptStatus } from '@citeladder/contracts';
import { ChevronDown, Pencil, Sparkles, Upload } from '@/lib/icons';
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

const ENABLED_FILTER_LABEL: Record<EnabledFilter, string> = {
  all: 'All prompts',
  enabled: 'Enabled only',
  disabled: 'Disabled only',
};

const BRANDED_FILTER_LABEL: Record<EnabledFilter, string> = {
  all: 'All prompts',
  enabled: 'Branded only',
  disabled: 'Unbranded only',
};

const SINGLE_CHOICES = ['all', 'enabled', 'disabled'] as const;

function singleChoice({
  id,
  label,
  labels,
  value,
  onChange,
  icon,
}: Readonly<{
  id: string;
  label: string;
  labels: Record<EnabledFilter, string>;
  value: EnabledFilter;
  onChange: (value: EnabledFilter) => void;
  icon?: FilterIcon;
}>): FilterDefinition {
  return choiceFilter({
    id,
    label,
    icon,
    value,
    defaultValue: 'all',
    groups: [
      { options: SINGLE_CHOICES.map((choice) => ({ value: choice, label: labels[choice] })) },
    ],
    onChange,
  });
}

type FilterChoice = Readonly<{ value: string; label: string }>;
type Patch = (part: Partial<PromptFilters>) => void;
type MeasuredChoices = Readonly<{
  brands: readonly FilterChoice[];
  sources: readonly FilterChoice[];
}>;

function measuredFilters({
  choices: { brands, sources },
  filters,
  patch,
}: Readonly<{
  choices: MeasuredChoices;
  filters: PromptFilters;
  patch: Patch;
}>): FilterDefinition[] {
  return [
    manyFilter({
      id: 'brands',
      label: 'Brands',
      allLabel: 'All brands',
      values: filters.brands,
      options: brands,
      onChange: (next) => patch({ brands: next }),
    }),
    ...(sources.length
      ? [
          manyFilter({
            id: 'sources',
            label: 'Sources',
            allLabel: 'All sources',
            values: filters.sources,
            options: sources,
            onChange: (next) => patch({ sources: next }),
          }),
        ]
      : []),
  ];
}

export function PromptStatusTabs({
  counts,
}: Readonly<{ counts: Readonly<Record<PromptStatus, number>> }>) {
  return (
    <TabRow
      ariaLabel="Prompt status"
      items={PROMPT_STATUSES.map((option) => ({
        value: option.value,
        label: option.label,
        count: counts[option.value],
      }))}
    />
  );
}

export function promptFilterControls({
  search,
  onSearchChange,
  filters,
  onFiltersChange,
  personas = [],
  measured,
  topic,
}: Readonly<{
  search: string;
  onSearchChange: (value: string) => void;
  filters: PromptFilters;
  onFiltersChange: (update: (current: PromptFilters) => PromptFilters) => void;
  personas?: readonly string[];
  measured?: MeasuredChoices;
  topic?: FilterDefinition;
}>): FilterBarProps {
  const patch: Patch = (part) => onFiltersChange((current) => ({ ...current, ...part }));
  return {
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
      singleChoice({
        id: 'branded',
        label: 'Branded',
        icon: 'prompts',
        labels: BRANDED_FILTER_LABEL,
        value: filters.branded,
        onChange: (branded) => patch({ branded }),
      }),
      manyFilter({
        id: 'intent',
        label: 'Intent',
        allLabel: 'All intents',
        values: filters.intents,
        options: intentValues.map((value) => ({ value, label: intentLabels[value] })),
        onChange: (intents) => patch({ intents }),
      }),
      manyFilter({
        id: 'stage',
        label: 'Buyer stage',
        allLabel: 'All stages',
        values: filters.stages,
        options: buyerStageValues.map((value) => ({ value, label: buyerStageLabels[value] })),
        onChange: (stages) => patch({ stages }),
      }),
      ...(personas.length
        ? [
            manyFilter({
              id: 'persona',
              label: 'Persona',
              allLabel: 'All personas',
              values: filters.personas,
              options: personas.map((value) => ({ value, label: value })),
              onChange: (next) => patch({ personas: next }),
            }),
          ]
        : []),
      ...(measured ? measuredFilters({ choices: measured, filters, patch }) : []),
      singleChoice({
        id: 'enabled',
        label: 'Enabled',
        labels: ENABLED_FILTER_LABEL,
        value: filters.enabled,
        onChange: (enabled) => patch({ enabled }),
      }),
    ],
  };
}

export type AddPromptsHandlers = Readonly<{
  onImport: () => void;
  onAdd: () => void;
  onGenerate: () => void;
}>;

export function PromptActions({
  add,
  inEmptyState = false,
}: Readonly<{ add: AddPromptsHandlers; inEmptyState?: boolean }>) {
  const canWrite = useWorkspaceCapability('write');
  return (
    <>
      {canWrite && !inEmptyState ? <AddPromptsMenu {...add} /> : null}
      <MastheadPrimary>
        <LaunchAuditButton />
      </MastheadPrimary>
    </>
  );
}

export function AddPromptsMenu({ onImport, onAdd, onGenerate }: AddPromptsHandlers) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant={ACTIONS.addPrompts.variant}>
          <Icon icon={ACTIONS.addPrompts.icon} />
          {ACTIONS.addPrompts.label}
          <Icon icon={ChevronDown} className="opacity-80" />
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem icon={<Icon icon={Pencil} />} onSelect={onAdd}>
          Write a prompt
        </MenuItem>
        <MenuItem icon={<Icon icon={Sparkles} />} onSelect={onGenerate}>
          Prompt builder
        </MenuItem>
        <MenuItem icon={<Icon icon={Upload} />} onSelect={onImport}>
          Bulk upload
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
