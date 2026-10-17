'use client';

import { CalendarRange, CircleHelp, Download } from 'lucide-react';

import { LaunchAuditButton } from '@/components/runs/launch-audit-button';
import { Button } from '@/components/ui/button';
import { FilterChoice, FilterTrigger } from '@/components/ui/filter-row';
import {
  Dropdown,
  DropdownContent,
  DropdownLabel,
  DropdownRadioGroup,
  DropdownRadioItem,
  DropdownSeparator,
  DropdownTrigger,
} from '@/components/ui/dropdown';
import { Tooltip } from '@/components/ui/tooltip';
import type { LogicalEngine } from '@/lib/api/types';
import type { ProjectMarket } from '@citeladder/contracts/markets';
import { ICONS } from '@/lib/icons';
import { isSearchSurfaceEngine } from '@/lib/providers/catalog';
import {
  engineLabel,
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
  TREND_ENGINES,
  type TrendGranularity,
  type TrendRange,
} from '@/lib/visibility/trends';

type EngineFilter = LogicalEngine | 'all';
const METRICS_HELP_URL = '/faq';

/**
 * Trigger copy for the prompt cohort: whether the questions name a brand.
 * Unbranded questions are the honest headline; branded comparison questions
 * name the brand or a competitor, so they read separately.
 */
const COHORT_LABELS = {
  core: 'Unbranded prompts',
  comparison: 'Branded prompts',
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
 * Two clusters, and every control answers a question a customer would actually
 * ask: which measurement, over what period, about which prompts and surfaces.
 *
 * What used to sit here and no longer does: a separate "Measurement selection"
 * toggle (folded into the measurement picker, because "which run am I looking
 * at" is one question, not two), a "Comparison baseline" picker and a "Frozen
 * configuration" picker (both are analyst controls that named internal
 * machinery; they stay honoured from the URL and are no longer surfaced as
 * permanent chrome).
 */
export function VisibilityToolbar(props: ToolbarProps) {
  const evidence = isEvidenceTab(props.activeTab);
  return (
    <div className="contents" data-testid="visibility-toolbar">
      <MarketFilter {...props} />
      <MeasurementFilter {...props} />
      <RangeFilter {...props} />
      {props.activeTab === 'trends' ? <GranularityFilter {...props} /> : null}
      <span className="bg-border mx-1 hidden h-5 w-px sm:block" aria-hidden />
      <CohortFilter {...props} />
      <EngineFilterControl {...props} />
      {evidence ? <PromptFilter {...props} /> : null}
      {/* The answer-outcome narrowing belongs with the rest of the filters
          rather than in a second row under them. It applies wherever answers
          are rendered, which is Query fanouts. */}
      {evidence && props.onChangeOutcome ? (
        <FilterChoice
          label="Answer outcome"
          value={props.outcome ?? 'all'}
          options={ANSWER_OUTCOMES}
          onChange={(value) => props.onChangeOutcome?.(value === 'all' ? null : value)}
        />
      ) : null}
    </div>
  );
}

const DEFAULT_MARKET = 'default';

/** Which market the page reads; offered only once a project measures more than one. */
export function MarketFilter({
  markets = [],
  market = null,
  onChangeMarket,
}: Pick<ToolbarProps, 'markets' | 'market' | 'onChangeMarket'>) {
  if (markets.length < 2 || !onChangeMarket) return null;
  return (
    <FilterChoice
      label="Select market"
      menuLabel="Market"
      value={market ?? DEFAULT_MARKET}
      defaultValue={DEFAULT_MARKET}
      options={markets.map((option) => ({
        value: option.id ?? DEFAULT_MARKET,
        label: option.label,
      }))}
      onChange={(value) => onChangeMarket(value === DEFAULT_MARKET ? null : value)}
      icon={ICONS.market}
    />
  );
}

const COHORT_OPTIONS = PROMPT_COHORTS.map((value) => ({
  value,
  label: COHORT_LABELS[value],
}));

function CohortFilter({ cohort, onChangeCohort }: ToolbarProps) {
  return (
    <FilterChoice
      label="Filter by branding"
      menuLabel="Prompts"
      value={cohort}
      defaultValue="core"
      options={COHORT_OPTIONS}
      onChange={onChangeCohort}
      icon={ICONS.prompts}
    />
  );
}

/**
 * Which measurement the page is reading — one run, or every run in the period.
 *
 * These were two adjacent chips ("Selected run" beside "Latest run"), which
 * asked the reader to hold a mode and a value apart before either meant
 * anything. One menu, one answer.
 */
function MeasurementFilter({
  runs,
  selectedRunId,
  onSelectMeasurement,
  selectionMode,
  onChangeSelectionMode,
}: ToolbarProps) {
  const pooled = selectionMode === 'range';
  const selected = runs.find((run) => run.id === selectedRunId);
  // A selected run the list no longer carries is not the latest run: saying so
  // keeps a stale link from reading as a fresh measurement.
  const missingRunLabel = selectedRunId ? 'Run unavailable' : 'Latest run';
  const current = pooled ? 'All runs in period' : (selected?.label ?? missingRunLabel);
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <FilterTrigger
          label="Select measurement"
          hideLabel
          value={current}
          active={pooled || Boolean(selectedRunId)}
          icon={ICONS.runs}
        />
      </DropdownTrigger>
      <DropdownContent>
        <DropdownLabel>Measurement</DropdownLabel>
        <DropdownRadioGroup value={pooled ? '__range__' : (selectedRunId ?? '__latest__')}>
          <DropdownRadioItem value="__latest__" onSelect={() => onSelectMeasurement(null)}>
            Latest run
          </DropdownRadioItem>
          <DropdownRadioItem value="__range__" onSelect={() => onChangeSelectionMode('range')}>
            All runs in period
          </DropdownRadioItem>
          {runs.length ? (
            <>
              <DropdownSeparator />
              <DropdownLabel>Individual runs</DropdownLabel>
              {runs.map((run) => (
                <DropdownRadioItem
                  key={run.id}
                  value={run.id}
                  onSelect={() => onSelectMeasurement(run.id)}
                >
                  {run.label}
                </DropdownRadioItem>
              ))}
            </>
          ) : null}
        </DropdownRadioGroup>
      </DropdownContent>
    </Dropdown>
  );
}

/**
 * Which measured surface the page is reading.
 *
 * Two groups, not one flat list, and the control no longer says "model". An
 * answer engine is ASKED a question and answers with a model; Google's AI
 * Overview is OBSERVED on a results page and has no model at all. Listing
 * them together under "All models" described three of the four correctly and
 * quietly misdescribed the fourth.
 */
function EngineFilterControl({ engine, onChangeEngine }: ToolbarProps) {
  const asked = TREND_ENGINES.filter((key) => !isSearchSurfaceEngine(key));
  const observed = TREND_ENGINES.filter((key) => isSearchSurfaceEngine(key));
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <FilterTrigger
          label="Filter by surface"
          hideLabel
          value={engine === 'all' ? 'All surfaces' : engineLabel(engine)}
          active={engine !== 'all'}
          icon={ICONS.analytics}
        />
      </DropdownTrigger>
      <DropdownContent>
        <DropdownLabel>Surface</DropdownLabel>
        <DropdownRadioGroup value={engine}>
          <DropdownRadioItem value="all" onSelect={() => onChangeEngine('all')}>
            All surfaces
          </DropdownRadioItem>
          <DropdownSeparator />
          <DropdownLabel>Answer engines</DropdownLabel>
          {asked.map((key) => (
            <DropdownRadioItem key={key} value={key} onSelect={() => onChangeEngine(key)}>
              {engineLabel(key)}
            </DropdownRadioItem>
          ))}
          {observed.length ? (
            <>
              <DropdownSeparator />
              <DropdownLabel>Observed surfaces</DropdownLabel>
              {observed.map((key) => (
                <DropdownRadioItem key={key} value={key} onSelect={() => onChangeEngine(key)}>
                  {engineLabel(key)}
                </DropdownRadioItem>
              ))}
            </>
          ) : null}
        </DropdownRadioGroup>
      </DropdownContent>
    </Dropdown>
  );
}

function RangeFilter({ range, onChangeRange }: ToolbarProps) {
  return (
    <FilterChoice
      label="Select date range"
      menuLabel="Period"
      value={range}
      defaultValue="90d"
      options={RANGE_OPTIONS}
      onChange={onChangeRange}
      icon={CalendarRange}
    />
  );
}

function GranularityFilter({ granularity, onChangeGranularity }: ToolbarProps) {
  return (
    <FilterChoice
      label="Select granularity"
      menuLabel="Group history by"
      value={granularity}
      defaultValue="run"
      options={GRANULARITY_OPTIONS}
      onChange={onChangeGranularity}
    />
  );
}

function PromptFilter({ promptOptions, promptId, onChangePrompt }: ToolbarProps) {
  const prompt = promptOptions.find((option) => option.id === promptId);
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <FilterTrigger
          label="Filter by prompt"
          hideLabel
          value={prompt?.label ?? 'Every prompt'}
          active={promptId !== null}
          icon={ICONS.prompts}
          className="max-w-64"
        />
      </DropdownTrigger>
      <DropdownContent>
        <DropdownLabel>Prompt</DropdownLabel>
        <DropdownRadioGroup value={promptId ?? '__all__'}>
          <DropdownRadioItem value="__all__" onSelect={() => onChangePrompt(null)}>
            Every prompt
          </DropdownRadioItem>
          {promptOptions.map((option) => (
            <DropdownRadioItem
              key={option.id}
              value={option.id}
              onSelect={() => onChangePrompt(option.id)}
            >
              {option.label}
            </DropdownRadioItem>
          ))}
        </DropdownRadioGroup>
      </DropdownContent>
    </Dropdown>
  );
}

/** Toolbar-adjacent actions, hoisted to the tab row so the filters keep one line. */
export function VisibilityActions() {
  return (
    <>
      <LaunchAuditButton size="sm" />
      <Tooltip content="How these metrics are calculated">
        <Button variant="secondary" size="iconSm" asChild>
          <a href={METRICS_HELP_URL} aria-label="About these metrics">
            <CircleHelp className="size-3.5" aria-hidden />
          </a>
        </Button>
      </Tooltip>
      <Tooltip content="Export is available from a run (coming with reports)">
        <span>
          <Button variant="secondary" size="sm" disabled aria-disabled="true">
            <Download className="size-3.5" aria-hidden />
            Export
          </Button>
        </span>
      </Tooltip>
    </>
  );
}
