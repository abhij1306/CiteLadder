import { estimateUsd, runEstimate } from './search-intelligence-format';
import {
  FIXED_DEPTH_KINDS,
  SEARCH_DATASET_LABELS,
  SEARCH_MARKET_OPTIONS,
  searchMarketLabel,
  searchScopeLabel,
} from '@/lib/config/search-intelligence';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Disclosure } from '@/components/ui/disclosure';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Stack } from '@/components/ui/layout';
import { panelClasses } from '@/components/ui/panel';
import { Select } from '@/components/ui/select';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses } from '@/components/ui/workspace';
import { formatCount, pluralCount } from '@/lib/format';
import type {
  DatasetSelection,
  ResearchScope,
  SearchIntelligenceReadiness,
  SearchIntelligenceRun,
} from '@/lib/api/search-intelligence';
import { useMemo } from 'react';
import {
  availableSelections,
  historyScopeConflict,
  reviewCompetitors,
  selectionKey,
} from './search-intelligence-review-selection';

export type Advanced = {
  researchScope: ResearchScope;
  ownedTarget: string;
  language: string;
  rankingOrder: DatasetSelection['order'];
  acquisitionVolume: string;
  grouping: 'as_is' | 'one_per_domain';
  reuse: boolean;
  saveDefaults: boolean;
};

export function marketOptions(location: string) {
  return location && !SEARCH_MARKET_OPTIONS.some((item) => item.value === location)
    ? [...SEARCH_MARKET_OPTIONS, { value: location, label: searchMarketLabel(Number(location)) }]
    : SEARCH_MARKET_OPTIONS;
}

/**
 * The datasets on offer: your website and the first competitor open, the other
 * competitors one disclosure away so a first review stays short.
 */
export function DatasetChoices({
  readiness,
  isSelected,
  onToggle,
  depthOf,
  onDepth,
}: Readonly<{
  readiness: SearchIntelligenceReadiness;
  isSelected: (option: DatasetSelection) => boolean;
  onToggle: (option: DatasetSelection) => void;
  depthOf: (option: DatasetSelection) => string;
  onDepth: (option: DatasetSelection, text: string) => void;
}>) {
  const { entries, firstCompetitor } = useMemo(() => {
    const groups = new Map<string, DatasetSelection[]>();
    for (const selection of availableSelections(readiness)) {
      const key = selection.competitor_id ?? 'owned';
      const group = groups.get(key);
      if (group) group.push(selection);
      else groups.set(key, [selection]);
    }
    return { entries: [...groups.entries()], firstCompetitor: reviewCompetitors(readiness)[0] };
  }, [readiness]);
  const group = ([owner, options]: [string, DatasetSelection[]]) => (
    <DatasetGroup
      key={owner}
      legend={
        owner === 'owned'
          ? 'Your website'
          : (readiness.competitors.find((item) => item.identity === owner)?.label ?? 'Competitor')
      }
      options={options}
      isSelected={isSelected}
      onToggle={onToggle}
      depthOf={depthOf}
      onDepth={onDepth}
    />
  );
  const others = entries.filter(([owner]) => owner !== 'owned' && owner !== firstCompetitor);
  return (
    <>
      {entries.filter(([owner]) => owner === 'owned' || owner === firstCompetitor).map(group)}
      {others.length ? (
        <Disclosure title={`Other competitors (${others.length})`}>{others.map(group)}</Disclosure>
      ) : null}
    </>
  );
}

function DatasetGroup({
  legend,
  options,
  isSelected,
  onToggle,
  depthOf,
  onDepth,
}: Readonly<{
  legend: string;
  options: DatasetSelection[];
  isSelected: (option: DatasetSelection) => boolean;
  onToggle: (option: DatasetSelection) => void;
  depthOf: (option: DatasetSelection) => string;
  onDepth: (option: DatasetSelection, text: string) => void;
}>) {
  return (
    <fieldset className={panelClasses({ tone: 'panel' })}>
      <legend className={textRole('label', 'px-1')}>{legend}</legend>
      <Stack gap="compact">
        {options.map((option) => {
          const checked = isSelected(option);
          const label = SEARCH_DATASET_LABELS[option.kind] ?? option.kind;
          return (
            <div
              key={selectionKey(option)}
              className="grid grid-cols-[1fr_6rem] items-center gap-3"
            >
              <Checkbox checked={checked} onCheckedChange={() => onToggle(option)} label={label} />
              {FIXED_DEPTH_KINDS.includes(option.kind) ? null : (
                <Input
                  aria-label={`${label}: number of results`}
                  disabled={!checked}
                  inputMode="numeric"
                  value={depthOf(option)}
                  onChange={(event) => onDepth(option, event.target.value)}
                />
              )}
            </div>
          );
        })}
      </Stack>
    </fieldset>
  );
}

export function AdvancedOptions({
  targets,
  values,
  set,
}: Readonly<{
  targets: SearchIntelligenceReadiness['owned_targets'];
  values: Advanced;
  set: { [K in keyof Advanced]: (value: Advanced[K]) => void };
}>) {
  return (
    <Disclosure title="Advanced options">
      <Field label="Research scope">
        {(field) => (
          <Select
            {...field}
            ariaLabel="Research scope"
            value={values.researchScope}
            onValueChange={set.researchScope}
            options={[
              { value: 'domain_subdomains', label: 'Domain + subdomains' },
              { value: 'exact_host', label: 'Exact host' },
            ]}
          />
        )}
      </Field>
      {targets.length > 1 ? (
        <Field label="Website">
          {(field) => (
            <Select
              {...field}
              ariaLabel="Website"
              value={values.ownedTarget}
              onValueChange={set.ownedTarget}
              options={targets.map((target) => ({ value: target.identity, label: target.label }))}
            />
          )}
        </Field>
      ) : null}
      <Field label="Keyword language" hint="A two-letter code, such as en or de.">
        {(field) => (
          <Input
            {...field}
            value={values.language}
            onChange={(event) => set.language(event.target.value)}
          />
        )}
      </Field>
      <Field
        label="Keyword order"
        hint="Which keywords are fetched first when there are more than you asked for."
      >
        {(field) => (
          <Select
            {...field}
            ariaLabel="Keyword order"
            value={values.rankingOrder}
            onValueChange={set.rankingOrder}
            options={[
              { value: 'volume', label: 'Highest search volume' },
              { value: 'traffic', label: 'Most estimated traffic' },
              { value: 'position', label: 'Best position' },
              { value: 'difficulty', label: 'Lowest difficulty' },
              { value: 'cpc', label: 'Highest cost per click' },
            ]}
          />
        )}
      </Field>
      <Field label="Minimum search volume" hint="Keywords below this volume are not fetched.">
        {(field) => (
          <Input
            {...field}
            type="number"
            min={0}
            step={1}
            value={values.acquisitionVolume}
            onChange={(event) => {
              const value = event.target.value;
              if (value === '' || (Number.isInteger(Number(value)) && Number(value) >= 0))
                set.acquisitionVolume(value);
            }}
          />
        )}
      </Field>
      <Field label="Backlink grouping">
        {(field) => (
          <Select
            {...field}
            ariaLabel="Backlink grouping"
            value={values.grouping}
            onValueChange={set.grouping}
            options={[
              { value: 'as_is', label: 'Every backlink' },
              { value: 'one_per_domain', label: 'One backlink per linking domain' },
            ]}
          />
        )}
      </Field>
      <Checkbox
        checked={values.reuse}
        onCheckedChange={(checked) => set.reuse(checked === true)}
        label="Reuse results saved in the last 30 days instead of fetching them again"
      />
      <Checkbox
        checked={values.saveDefaults}
        onCheckedChange={(checked) => set.saveDefaults(checked === true)}
        label="Remember these choices for this project"
      />
    </Disclosure>
  );
}

export function ReviewFooter({
  review,
  selected,
  canReview,
  busy,
  onBack,
  onReview,
  onConfirm,
}: Readonly<{
  review: SearchIntelligenceRun | null;
  selected: number;
  canReview: boolean;
  busy: boolean;
  onBack: () => void;
  onReview: () => void;
  onConfirm: () => void;
}>) {
  if (review)
    return (
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button disabled={busy} onClick={onConfirm}>
          Confirm {runEstimate(review)} analysis
        </Button>
      </div>
    );
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={textRole('caption')}>{pluralCount(selected, 'dataset')} selected</span>
      <Button disabled={busy || !canReview} onClick={onReview}>
        Review cost
      </Button>
    </div>
  );
}

export function HistoryScopeNotice({
  scope,
  selections,
}: Readonly<{ scope: ResearchScope; selections: DatasetSelection[] }>) {
  if (!historyScopeConflict(selections, scope)) return null;
  return (
    <Alert>
      Backlink history covers the whole domain. Deselect it or set the research scope to Domain +
      subdomains.
    </Alert>
  );
}

function hostOf(target: unknown): string {
  const origin =
    typeof target === 'object' && target ? (target as { origin?: unknown }).origin : '';
  try {
    return new URL(String(origin)).hostname;
  } catch {
    return '';
  }
}

export function ReviewSummary({ review }: Readonly<{ review: SearchIntelligenceRun }>) {
  const scope = review.frozen_scope.research_scope;
  return (
    <Stack gap="workspace">
      <Stack as="section" gap="compact">
        <h3 className={textRole('sectionTitle')}>What will be fetched</h3>
        <dl className="type-body grid grid-cols-2 gap-[var(--compact-gap)]">
          <div>
            <dt className="type-label">Requests</dt>
            <dd className="type-figure">{review.planned_calls}</dd>
          </div>
          <div>
            <dt className="type-label">Results, at most</dt>
            <dd className="type-figure">{formatCount(review.planned_rows)}</dd>
          </div>
          <div>
            <dt className="type-label">Estimated cost</dt>
            <dd className="type-figure">{runEstimate(review)}</dd>
          </div>
          <div>
            <dt className="type-label">Scope</dt>
            <dd>{searchScopeLabel(typeof scope === 'string' ? scope : undefined)}</dd>
          </div>
        </dl>
        <p className={textRole('caption')}>
          The estimate is a ceiling: a request that could take the cost past it is not sent.
          DataForSEO bills your own account.
        </p>
      </Stack>
      {review.call_plan.length ? (
        <Stack as="section" gap="compact">
          <h3 className={textRole('sectionTitle')}>Requests</h3>
          <ul className={ledgerClasses('boxed', 'type-body')}>
            {review.call_plan.map((call) => {
              const target = hostOf(call.target),
                comparison = hostOf(call.comparison);
              return (
                <li
                  className="flex justify-between gap-3 py-2"
                  key={`${String(call.dataset_key)}:${String(call.page)}`}
                >
                  <span>
                    {SEARCH_DATASET_LABELS[String(call.dataset_kind)] ?? String(call.dataset_kind)}
                    {target ? ` · ${target}` : ''}
                    {comparison ? ` vs ${comparison}` : ''}
                  </span>
                  {call.estimated_cost_usd === undefined ? null : (
                    <span className="text-muted">
                      ${estimateUsd(String(call.estimated_cost_usd))}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Stack>
      ) : null}
      {review.reused_datasets.length ? (
        <p className="type-body">
          {pluralCount(review.reused_datasets.length, 'recent result')} will be reused at no cost.
        </p>
      ) : null}
    </Stack>
  );
}
