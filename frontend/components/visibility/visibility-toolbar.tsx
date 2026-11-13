import { CircleHelp } from 'lucide-react';

import { LaunchAuditButton } from '@/components/runs/launch-audit-button';
import { choiceFilter, type FilterDefinition } from '@/components/ui/all-filters';
import { IconButton } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import type { LogicalEngine } from '@citeladder/contracts';
import type { ProjectMarket } from '@citeladder/contracts/markets';
import { useEngineCatalog } from '@/lib/providers/engines';
import {
  isEvidenceTab,
  type PromptOption,
  type RunOption,
  type VisibilityTab,
} from '@/lib/visibility/dashboard';
import { ANSWER_OUTCOMES } from '@/lib/config/visibility';
import { PROMPT_COHORTS, type PromptCohort } from '@/lib/visibility/prompt-cohort';
import {
  GRANULARITY_OPTIONS,
  RANGE_OPTIONS,
  type TrendGranularity,
  type TrendRange,
} from '@/lib/visibility/trends';

type EngineFilter = LogicalEngine | 'all';
const METRICS_HELP_URL = '/faq';

/**
 * The prompt cohort: whether the questions name a brand. Unbranded questions
 * are the honest headline; branded comparison questions name the brand or a
 * competitor, so they read separately. The filter is called "Prompts", so the
 * two cohorts name only their branding.
 */
const COHORT_LABELS = {
  core: 'Unbranded',
  comparison: 'Branded',
  all: 'All prompts',
} as const satisfies Record<PromptCohort, string>;

type ToolbarProps = Readonly<{
  activeTab: VisibilityTab;
  selectionMode?: 'run' | 'range';
  onChangeSelectionMode: (mode: 'run' | 'range') => void;
  runs: RunOption[];
  selectedRunId: string | null;
  /** Selects a run AND leaves range mode in one URL write. */
  onSelectMeasurement: (runId: string | null) => void;
  engine: EngineFilter;
  onChangeEngine: (engine: EngineFilter) => void;
  promptOptions: PromptOption[];
  promptId: string | null;
  onChangePrompt: (promptId: string | null) => void;
  range: TrendRange;
  onChangeRange: (range: TrendRange) => void;
  granularity: TrendGranularity;
  onChangeGranularity: (granularity: TrendGranularity) => void;
  cohort: PromptCohort;
  onChangeCohort: (cohort: PromptCohort) => void;
  outcome?: string | null;
  onChangeOutcome?: (outcome: string | null) => void;
  markets?: readonly ProjectMarket[];
  /** A non-default market's id; `null` is the project default. */
  market?: string | null;
  onChangeMarket?: (market: string | null) => void;
}>;

/**
 * The filters every AI visibility tab shares, for its All filters menu. Every
 * one answers a question a customer would ask: which market, which
 * measurement, about which prompts and surfaces, over what period.
 *
 * A period and a grouping only mean something while the page pools every run
 * in a period; beside "Latest run" or one named run they read as a
 * contradiction, so they are listed only then, and last. The prompt and
 * answer-outcome filters apply where answers are rendered (Query fanouts).
 *
 * The analyst controls that named internal machinery (a comparison baseline,
 * a frozen configuration) stay honoured from the URL and are not offered.
 */
export function useVisibilityFilterMenu(props: ToolbarProps): FilterDefinition[] {
  const catalog = useEngineCatalog();
  const evidence = isEvidenceTab(props.activeTab);
  const pooled = props.selectionMode === 'range';
  const filters: (FilterDefinition | null)[] = [
    marketFilter(props),
    measurementFilter(props),
    choiceFilter({
      id: 'cohort',
      label: 'Prompts',
      value: props.cohort,
      defaultValue: 'core',
      groups: [
        { options: PROMPT_COHORTS.map((value) => ({ value, label: COHORT_LABELS[value] })) },
      ],
      onChange: props.onChangeCohort,
    }),
    engineFilter(props, catalog),
    evidence ? promptFilter(props) : null,
    evidence ? outcomeFilter(props) : null,
    pooled
      ? choiceFilter({
          id: 'range',
          label: 'Period',
          value: props.range,
          defaultValue: '90d',
          groups: [{ options: RANGE_OPTIONS }],
          onChange: props.onChangeRange,
        })
      : null,
    pooled && props.activeTab === 'trends'
      ? choiceFilter({
          id: 'granularity',
          label: 'Group by',
          value: props.granularity,
          defaultValue: 'run',
          groups: [{ options: GRANULARITY_OPTIONS }],
          onChange: props.onChangeGranularity,
        })
      : null,
  ];
  return filters.filter((filter): filter is FilterDefinition => filter !== null);
}

const DEFAULT_MARKET = 'default';

/** Which market the page reads; offered only once a project measures more than one. */
export function marketFilter({
  markets = [],
  market = null,
  onChangeMarket,
}: Pick<ToolbarProps, 'markets' | 'market' | 'onChangeMarket'>): FilterDefinition | null {
  if (markets.length < 2 || !onChangeMarket) return null;
  return choiceFilter({
    id: 'market',
    label: 'Market',
    value: market ?? DEFAULT_MARKET,
    defaultValue: DEFAULT_MARKET,
    groups: [
      {
        options: markets.map((option) => ({
          value: option.id ?? DEFAULT_MARKET,
          label: option.label,
        })),
      },
    ],
    onChange: (value) => onChangeMarket(value === DEFAULT_MARKET ? null : value),
  });
}

const LATEST = '__latest__';
const POOLED = '__range__';

/**
 * Which measurement the page is reading: one run, or every run in the period.
 * One filter, because "which run am I looking at" is one question, not a mode
 * and a value held apart.
 */
function measurementFilter({
  runs,
  selectedRunId,
  onSelectMeasurement,
  selectionMode,
  onChangeSelectionMode,
}: ToolbarProps): FilterDefinition {
  const pooled = selectionMode === 'range';
  const selected = runs.find((run) => run.id === selectedRunId);
  // A selected run the list no longer carries is not the latest run: saying so
  // keeps a stale link from reading as a fresh measurement.
  const missingRunLabel = selectedRunId ? 'Run unavailable' : 'Latest run';
  return choiceFilter({
    id: 'measurement',
    label: 'Measurement',
    value: pooled ? POOLED : (selectedRunId ?? LATEST),
    defaultValue: LATEST,
    valueLabel: pooled ? 'All runs in period' : (selected?.label ?? missingRunLabel),
    groups: [
      {
        options: [
          { value: LATEST, label: 'Latest run' },
          { value: POOLED, label: 'All runs in period' },
        ],
      },
      ...(runs.length
        ? [
            {
              label: 'Individual runs',
              options: runs.map((run) => ({ value: run.id, label: run.label })),
            },
          ]
        : []),
    ],
    onChange: (value) => {
      if (value === POOLED) onChangeSelectionMode('range');
      else onSelectMeasurement(value === LATEST ? null : value);
    },
  });
}

/**
 * Which measured surface the page is reading, in two groups. An answer engine
 * is ASKED a question and answers with a model; Google's AI Overview is
 * OBSERVED on a results page and has no model, so the filter says "surface".
 */
function engineFilter(
  { engine, onChangeEngine }: ToolbarProps,
  catalog: ReturnType<typeof useEngineCatalog>,
): FilterDefinition {
  const option = (key: LogicalEngine) => ({ value: key, label: catalog.label(key) });
  const asked = catalog.order.filter((key) => !catalog.isSearchSurface(key));
  const observed = catalog.order.filter((key) => catalog.isSearchSurface(key));
  return choiceFilter<EngineFilter>({
    id: 'engine',
    label: 'Surface',
    value: engine,
    defaultValue: 'all',
    valueLabel: engine === 'all' ? 'All surfaces' : catalog.label(engine),
    groups: [
      { options: [{ value: 'all', label: 'All surfaces' }] },
      { label: 'Answer engines', options: asked.map(option) },
      ...(observed.length ? [{ label: 'Observed surfaces', options: observed.map(option) }] : []),
    ],
    onChange: onChangeEngine,
  });
}

const EVERY_PROMPT = '__all__';

/** One tracked prompt; the list is long, so its submenu searches. */
function promptFilter({ promptOptions, promptId, onChangePrompt }: ToolbarProps): FilterDefinition {
  return choiceFilter({
    id: 'prompt',
    label: 'Prompt',
    value: promptId ?? EVERY_PROMPT,
    defaultValue: EVERY_PROMPT,
    groups: [
      {
        options: [
          { value: EVERY_PROMPT, label: 'Every prompt' },
          ...promptOptions.map((option) => ({ value: option.id, label: option.label })),
        ],
      },
    ],
    onChange: (value) => onChangePrompt(value === EVERY_PROMPT ? null : value),
  });
}

function outcomeFilter({ outcome, onChangeOutcome }: ToolbarProps): FilterDefinition | null {
  if (!onChangeOutcome) return null;
  return choiceFilter({
    id: 'outcome',
    label: 'Answer outcome',
    value: outcome ?? 'all',
    defaultValue: 'all',
    groups: [{ options: ANSWER_OUTCOMES }],
    onChange: (value) => onChangeOutcome(value === 'all' ? null : value),
  });
}

/** Header actions beside the page title: run a new audit, and how the metrics work. */
export function VisibilityActions() {
  return (
    <>
      <LaunchAuditButton />
      <Tooltip content="How these metrics are calculated">
        <IconButton
          variant="secondary"
          icon={CircleHelp}
          label="About these metrics"
          tooltip={false}
          href={METRICS_HELP_URL}
        />
      </Tooltip>
    </>
  );
}
