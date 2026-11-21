import { LaunchAuditButton } from '@/components/runs/launch-audit-button';
import { choiceFilter, type FilterDefinition } from '@/components/ui/all-filters';
import { IconButton } from '@/components/ui/button';
import { engineOptionMark } from '@/components/ui/engine-mark';
import { MastheadPrimary } from '@/components/ui/masthead-actions';
import { Tooltip } from '@/components/ui/tooltip';
import { CircleHelp } from '@/lib/icons';
import type { LogicalEngine } from '@citeladder/contracts';
import type { ProjectMarket } from '@citeladder/contracts/markets';
import { useEngineCatalog } from '@/lib/providers/engines';
import {
  isEvidenceTab,
  type PromptOption,
  type RunOption,
  type VisibilityView,
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

const COHORT_LABELS = {
  core: 'Unbranded',
  comparison: 'Branded',
  all: 'All prompts',
} as const satisfies Record<PromptCohort, string>;

type ToolbarProps = Readonly<{
  view: VisibilityView;
  selectionMode?: 'run' | 'range';
  runs: RunOption[];
  selectedRunId: string | null;
  onSelectMeasurement: (runId: string | null) => void;
  engine: EngineFilter;
  onChangeEngine: (engine: EngineFilter) => void;
  promptOptions: PromptOption[];
  promptId: string | null;
  onChangePrompt: (promptId: string | null) => void;
  range: TrendRange;
  onSelectPeriod: (range: TrendRange) => void;
  granularity: TrendGranularity;
  onChangeGranularity: (granularity: TrendGranularity) => void;
  cohort: PromptCohort;
  onChangeCohort: (cohort: PromptCohort) => void;
  outcome?: string | null;
  onChangeOutcome?: (outcome: string | null) => void;
  markets?: readonly ProjectMarket[];
  market?: string | null;
  onChangeMarket?: (market: string | null) => void;
  topics?: readonly { id: string; name: string }[];
  topic?: string | null;
  onChangeTopic?: (topic: string | null) => void;
}>;

export function useVisibilityFilterMenu(props: ToolbarProps): FilterDefinition[] {
  const catalog = useEngineCatalog();
  const evidence = isEvidenceTab(props.view);
  const pooled = props.selectionMode === 'range';
  const filters: Record<FilterId, FilterDefinition | null> = {
    market: marketFilter(props),
    measurement: measurementFilter(props),
    cohort: choiceFilter({
      id: 'cohort',
      label: 'Prompts',
      icon: 'prompts',
      value: props.cohort,
      defaultValue: 'core',
      groups: [
        { options: PROMPT_COHORTS.map((value) => ({ value, label: COHORT_LABELS[value] })) },
      ],
      onChange: props.onChangeCohort,
    }),
    engine: engineFilter(props, catalog),
    topic: topicFilter(props),
    prompt: evidence ? promptFilter(props) : null,
    outcome: evidence ? outcomeFilter(props) : null,
    granularity:
      pooled && (props.view === 'insights' || props.view === 'competitor')
        ? choiceFilter({
            id: 'granularity',
            label: 'Group by',
            value: props.granularity,
            defaultValue: 'run',
            groups: [{ options: GRANULARITY_OPTIONS }],
            onChange: props.onChangeGranularity,
          })
        : null,
  };
  const { row, inFilters } = placement(props.view);
  const pick = (ids: readonly FilterId[]) =>
    ids.map((id) => filters[id]).filter((filter): filter is FilterDefinition => filter !== null);
  return [...pick(row), ...pick(inFilters).map((filter) => ({ ...filter, inFilters: true }))];
}

type FilterId =
  | 'market'
  | 'measurement'
  | 'cohort'
  | 'engine'
  | 'topic'
  | 'prompt'
  | 'outcome'
  | 'granularity';

function placement(view: VisibilityView): Readonly<{
  row: readonly FilterId[];
  inFilters: readonly FilterId[];
}> {
  const tail = ['prompt', 'outcome', 'granularity'] as const;
  if (view === 'insights')
    return { row: ['measurement', 'engine', 'market', 'cohort', 'topic'], inFilters: tail };
  if (view === 'competitors' || view === 'competitor' || view === 'perception')
    return { row: ['measurement', 'engine', 'market', 'topic', 'cohort'], inFilters: tail };
  return { row: ['measurement', 'engine', 'cohort', 'topic'], inFilters: ['market', ...tail] };
}

const DEFAULT_MARKET = 'default';

export function marketFilter({
  markets = [],
  market = null,
  onChangeMarket,
}: Pick<ToolbarProps, 'markets' | 'market' | 'onChangeMarket'>): FilterDefinition | null {
  if (markets.length < 2 || !onChangeMarket) return null;
  return choiceFilter({
    id: 'market',
    label: 'Market',
    icon: 'market',
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
const PERIOD = 'period:';

function measurementFilter({
  runs,
  selectedRunId,
  onSelectMeasurement,
  selectionMode,
  range,
  onSelectPeriod,
}: ToolbarProps): FilterDefinition {
  const pooled = selectionMode === 'range';
  const selected = runs.find((run) => run.id === selectedRunId);
  const missingRunLabel = selectedRunId ? 'Run unavailable' : 'Latest run';
  const [latest] = runs;
  const periods = RANGE_OPTIONS.map((option) => ({ ...option, value: `${PERIOD}${option.value}` }));
  return choiceFilter({
    id: 'measurement',
    label: 'Measurement',
    icon: 'period',
    windowLabel: latest ? `Latest run · ${latest.label}` : undefined,
    value: pooled ? `${PERIOD}${range}` : (selectedRunId ?? LATEST),
    defaultValue: LATEST,
    valueLabel: pooled ? undefined : (selected?.label ?? missingRunLabel),
    groups: [
      { options: [{ value: LATEST, label: 'Latest run' }, ...periods] },
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
      const period = RANGE_OPTIONS.find((option) => `${PERIOD}${option.value}` === value);
      if (period) onSelectPeriod(period.value);
      else onSelectMeasurement(value === LATEST ? null : value);
    },
  });
}

function engineFilter(
  { engine, onChangeEngine }: ToolbarProps,
  catalog: ReturnType<typeof useEngineCatalog>,
): FilterDefinition {
  const option = (key: LogicalEngine) => ({
    value: key,
    label: catalog.label(key),
    mark: engineOptionMark(key),
  });
  const asked = catalog.order.filter((key) => !catalog.isSearchSurface(key));
  const observed = catalog.order.filter((key) => catalog.isSearchSurface(key));
  return choiceFilter<EngineFilter>({
    id: 'engine',
    label: 'Engines',
    icon: 'engines',
    value: engine,
    defaultValue: 'all',
    valueLabel: engine === 'all' ? 'All engines' : catalog.label(engine),
    groups: [
      { options: [{ value: 'all', label: 'All engines' }] },
      { label: 'Answer engines', options: asked.map(option) },
      ...(observed.length ? [{ label: 'Observed surfaces', options: observed.map(option) }] : []),
    ],
    onChange: onChangeEngine,
  });
}

const EVERY_TOPIC = '__all__';

function topicFilter({
  topics = [],
  topic = null,
  onChangeTopic,
}: ToolbarProps): FilterDefinition | null {
  if (!onChangeTopic || (topics.length === 0 && topic === null)) return null;
  return choiceFilter({
    id: 'topic',
    label: 'Topic',
    icon: 'topic',
    value: topic ?? EVERY_TOPIC,
    defaultValue: EVERY_TOPIC,
    valueLabel:
      topic === null
        ? 'All topics'
        : (topics.find((option) => option.id === topic)?.name ?? 'Deleted topic'),
    groups: [
      {
        options: [
          { value: EVERY_TOPIC, label: 'All topics' },
          ...topics.map((option) => ({ value: option.id, label: option.name })),
        ],
      },
    ],
    onChange: (value) => onChangeTopic(value === EVERY_TOPIC ? null : value),
  });
}

const EVERY_PROMPT = '__all__';

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

export function VisibilityActions({ launch = true }: Readonly<{ launch?: boolean }>) {
  return (
    <>
      {launch ? (
        <MastheadPrimary>
          <LaunchAuditButton />
        </MastheadPrimary>
      ) : null}
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
