'use client';

import { useState } from 'react';
import { SEARCH_MAX_DEPTH } from '@/lib/config/search-intelligence';

import { Alert } from '@/components/ui/alert';
import { Drawer } from '@/components/ui/drawer';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Stack } from '@/components/ui/layout';
import { Select } from '@/components/ui/select';
import type {
  DatasetSelection,
  ResearchScope,
  ReviewPayload,
  SearchIntelligenceReadiness,
  SearchIntelligenceRun,
} from '@/lib/api/search-intelligence';
import {
  comparisonOrderConflict,
  defaultSelections,
  prepareReviewSelections,
  reviewInputsValid,
  reviewOwnedTarget,
  selectionKey,
} from './search-intelligence-review-selection';
import {
  AdvancedOptions,
  DatasetChoices,
  HistoryScopeNotice,
  ReviewFooter,
  ReviewSummary,
  marketOptions,
} from './search-intelligence-review-parts';

/** Typed depths keep a draft per dataset, so a field can be cleared while typing. */
function useDatasetSelections(readiness: SearchIntelligenceReadiness, action: string) {
  const [selections, setSelections] = useState<DatasetSelection[]>(() =>
    defaultSelections(readiness, action),
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const isSelected = (candidate: DatasetSelection) =>
    selections.some((item) => selectionKey(item) === selectionKey(candidate));
  const toggle = (candidate: DatasetSelection) =>
    setSelections((current) =>
      isSelected(candidate)
        ? current.filter((item) => selectionKey(item) !== selectionKey(candidate))
        : [...current, candidate],
    );
  const setDepth = (candidate: DatasetSelection, text: string) => {
    setDrafts((current) => ({ ...current, [selectionKey(candidate)]: text }));
    const depth = Number(text);
    if (!Number.isInteger(depth) || depth < 1 || depth > SEARCH_MAX_DEPTH) return;
    setSelections((current) =>
      current.map((item) =>
        selectionKey(item) === selectionKey(candidate) ? { ...item, depth } : item,
      ),
    );
  };
  const depthOf = (option: DatasetSelection) => {
    const current = selections.find((item) => selectionKey(item) === selectionKey(option));
    return drafts[selectionKey(option)] ?? String(current?.depth ?? option.depth);
  };
  // A depth the reader is still typing has not reached its selection yet.
  const depthsValid = selections.every((item) => {
    const draft = drafts[selectionKey(item)];
    return draft === undefined || String(item.depth) === draft;
  });
  return { selections, isSelected, toggle, setDepth, depthOf, depthsValid };
}

export function SearchIntelligenceReviewDrawer({
  open,
  action,
  readiness,
  onOpenChange,
  onReview,
  onConfirm,
  busy,
}: Readonly<{
  open: boolean;
  action: string;
  readiness: SearchIntelligenceReadiness;
  onOpenChange: (open: boolean) => void;
  onReview: (payload: ReviewPayload) => Promise<SearchIntelligenceRun>;
  onConfirm: (runId: string) => Promise<void>;
  busy: boolean;
}>) {
  const datasets = useDatasetSelections(readiness, action);
  const [location, setLocation] = useState(String(readiness.preferences.location_code ?? ''));
  const [language, setLanguage] = useState(readiness.preferences.language_code || 'en');
  const [seed, setSeed] = useState('');
  const [researchScope, setResearchScope] = useState<ResearchScope>(
    () => readiness.preferences.research_scope ?? 'domain_subdomains',
  );
  const [grouping, setGrouping] = useState<'as_is' | 'one_per_domain'>('as_is');
  const [rankingOrder, setRankingOrder] = useState<DatasetSelection['order']>('volume');
  const [acquisitionVolume, setAcquisitionVolume] = useState('');
  const [ownedTarget, setOwnedTarget] = useState(reviewOwnedTarget(readiness)?.identity ?? '');
  const [reuse, setReuse] = useState(
    () => !['refresh', 'increase_depth'].includes(action) && readiness.preferences.reuse_recent,
  );
  const [saveDefaults, setSaveDefaults] = useState(false);
  const [review, setReview] = useState<SearchIntelligenceRun | null>(null);
  const [error, setError] = useState('');
  const { selections } = datasets;
  const canReview =
    datasets.depthsValid &&
    reviewInputsValid(selections, {
      ownedTarget,
      location,
      seed,
      researchScope,
      order: rankingOrder,
    });
  const failed = (cause: unknown, fallback: string) =>
    setError(cause instanceof Error ? cause.message : fallback);
  const submitReview = async () => {
    setError('');
    try {
      setReview(
        await onReview({
          action,
          research_scope: researchScope,
          owned_target_id: ownedTarget,
          location_code: location === '' ? null : Number(location),
          language_code: language,
          reuse_recent: reuse,
          save_as_defaults: saveDefaults,
          datasets: prepareReviewSelections(selections, {
            seed,
            grouping,
            order: rankingOrder,
            minVolume: acquisitionVolume,
          }),
          previous_run_id: action === 'analysis' ? null : (readiness.latest_run?.id ?? null),
        }),
      );
    } catch (cause) {
      failed(cause, 'The cost could not be reviewed.');
    }
  };
  const confirmReview = async (runId: string) => {
    setError('');
    try {
      await onConfirm(runId);
    } catch (cause) {
      failed(cause, 'The analysis could not be started.');
    }
  };
  const wantsSeed =
    action === 'seed' || selections.some(({ kind }) => kind === 'keyword_suggestions');
  return (
    <Drawer
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setReview(null);
          setError('');
        }
        onOpenChange(nextOpen);
      }}
      title={action === 'seed' ? 'Research a keyword' : 'Review analysis cost'}
      description="Nothing is fetched or charged until you confirm the estimate."
      footer={
        <ReviewFooter
          review={review}
          selected={selections.length}
          canReview={canReview}
          busy={busy}
          onBack={() => setReview(null)}
          onReview={() => {
            submitReview().catch(() => undefined);
          }}
          onConfirm={() => {
            if (review) confirmReview(review.id).catch(() => undefined);
          }}
        />
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      {review ? (
        <ReviewSummary review={review} />
      ) : (
        <Stack gap="workspace">
          <Field label="Market">
            {(field) => (
              <Select
                {...field}
                ariaLabel="Market"
                value={location}
                onValueChange={setLocation}
                placeholder="Select market"
                options={marketOptions(location)}
              />
            )}
          </Field>
          {wantsSeed ? (
            <Field label="Keyword suggestion seed" hint="The keyword to find related searches for.">
              {(field) => (
                <Input {...field} value={seed} onChange={(event) => setSeed(event.target.value)} />
              )}
            </Field>
          ) : null}
          <DatasetChoices
            readiness={readiness}
            isSelected={datasets.isSelected}
            onToggle={datasets.toggle}
            depthOf={datasets.depthOf}
            onDepth={datasets.setDepth}
          />
          <HistoryScopeNotice scope={researchScope} selections={selections} />
          {comparisonOrderConflict(selections, researchScope, rankingOrder) ? (
            <Alert>
              Keyword comparisons on an exact host can be ordered by volume, cost per click or
              difficulty. Change the keyword order or the research scope in Advanced options.
            </Alert>
          ) : null}
          <AdvancedOptions
            targets={readiness.owned_targets}
            values={{
              researchScope,
              ownedTarget,
              language,
              rankingOrder,
              acquisitionVolume,
              grouping,
              reuse,
              saveDefaults,
            }}
            set={{
              researchScope: setResearchScope,
              ownedTarget: setOwnedTarget,
              language: setLanguage,
              rankingOrder: setRankingOrder,
              acquisitionVolume: setAcquisitionVolume,
              grouping: setGrouping,
              reuse: setReuse,
              saveDefaults: setSaveDefaults,
            }}
          />
        </Stack>
      )}
    </Drawer>
  );
}
