import type {
  DatasetSelection,
  ResearchScope,
  SearchIntelligenceReadiness,
} from '@/lib/api/search-intelligence';
import {
  BACKLINK_DATASET_KINDS,
  COMPARISON_DATASET_KINDS,
  COMPETITOR_DATASET_KINDS,
  KEYWORD_DATASET_KINDS,
  OWNED_DATASET_KINDS,
  PRESET_OWNED_KINDS,
  SEARCH_DEFAULT_DEPTHS,
} from '@/lib/config/search-intelligence';
import { matchesCompetitor } from './search-intelligence-competitors';

export const selectionKey = (selection: DatasetSelection) =>
  `${selection.kind}:${selection.competitor_id ?? ''}`;

function depthFor(data: SearchIntelligenceReadiness, kind: string) {
  return (
    data.preferences.depths[kind] ??
    SEARCH_DEFAULT_DEPTHS[kind as keyof typeof SEARCH_DEFAULT_DEPTHS]
  );
}

/**
 * Every saved competitor, the remembered ones first. A remembered choice orders
 * the list; it never hides a competitor the project still has.
 */
export function reviewCompetitors(data: SearchIntelligenceReadiness): string[] {
  const all = data.competitors.map(({ identity }) => identity);
  const preferred = data.preferences.competitor_ids.filter((id) => all.includes(id));
  return [...preferred, ...all.filter((id) => !preferred.includes(id))];
}

/** The website the review starts on: the remembered one, else the first. */
export function reviewOwnedTarget(data: SearchIntelligenceReadiness) {
  return (
    data.owned_targets.find((target) => target.identity === data.preferences.owned_target_id) ??
    data.owned_targets[0]
  );
}

export function availableSelections(data: SearchIntelligenceReadiness): DatasetSelection[] {
  return [
    ...OWNED_DATASET_KINDS.map((kind) => ({ kind, depth: depthFor(data, kind) })),
    ...reviewCompetitors(data).flatMap((competitor_id) =>
      COMPETITOR_DATASET_KINDS.map((kind) => ({
        kind,
        competitor_id,
        depth: depthFor(data, kind),
      })),
    ),
  ];
}

/** Whether a saved dataset already answers this selection, so a refresh re-reads it. */
function saved(data: SearchIntelligenceReadiness, selection: DatasetSelection) {
  const owned = reviewOwnedTarget(data)?.origin;
  const competitor = data.competitors.find((item) => item.identity === selection.competitor_id);
  return data.datasets.some((dataset) => {
    if (dataset.dataset_kind !== selection.kind) return false;
    if (!competitor) return dataset.target_origin === owned && !dataset.comparison_origin;
    // A comparison belongs to one of your websites as well as the competitor;
    // one saved for another of your websites does not answer this review.
    if (COMPARISON_DATASET_KINDS.includes(selection.kind))
      return (
        dataset.target_origin === owned &&
        matchesCompetitor(dataset.comparison_origin, competitor.registrable_domain)
      );
    return matchesCompetitor(dataset.target_origin, competitor.registrable_domain);
  });
}

/**
 * What the review starts with. A keyword seed asks for suggestions only; a refresh
 * or deeper fetch re-reads what is saved; a new analysis starts from the small
 * preset: the owned footprint and rankings, and one competitor's keyword gaps.
 */
export function defaultSelections(
  data: SearchIntelligenceReadiness,
  action: string,
): DatasetSelection[] {
  const available = availableSelections(data);
  if (action === 'seed')
    return available.filter(
      ({ kind, competitor_id }) => kind === 'keyword_suggestions' && !competitor_id,
    );
  if (['refresh', 'increase_depth'].includes(action)) {
    const current = available.filter(
      (selection) => selection.kind !== 'keyword_suggestions' && saved(data, selection),
    );
    if (current.length) return current;
  }
  const [first] = reviewCompetitors(data);
  return available.filter(({ kind, competitor_id }) =>
    competitor_id
      ? competitor_id === first && COMPARISON_DATASET_KINDS.includes(kind)
      : PRESET_OWNED_KINDS.includes(kind),
  );
}

/** Exact-host comparisons cannot be ordered by traffic or position; the API refuses them. */
export function comparisonOrderConflict(
  selections: DatasetSelection[],
  researchScope: ResearchScope,
  order: DatasetSelection['order'],
) {
  return (
    researchScope === 'exact_host' &&
    (order === 'traffic' || order === 'position') &&
    selections.some(({ kind }) => COMPARISON_DATASET_KINDS.includes(kind))
  );
}

/** Backlink history covers the whole domain; the API refuses it for an exact host. */
export function historyScopeConflict(selections: DatasetSelection[], researchScope: ResearchScope) {
  return (
    researchScope === 'exact_host' && selections.some(({ kind }) => kind === 'backlink_history')
  );
}

export function reviewInputsValid(
  selections: DatasetSelection[],
  form: {
    ownedTarget: string;
    location: string;
    seed: string;
    researchScope: ResearchScope;
    order: DatasetSelection['order'];
  },
) {
  const marketNeeded = selections.some(({ kind }) => !BACKLINK_DATASET_KINDS.includes(kind));
  const location = Number(form.location);
  return Boolean(
    selections.length &&
    form.ownedTarget &&
    (!marketNeeded || (Number.isInteger(location) && location > 0)) &&
    !historyScopeConflict(selections, form.researchScope) &&
    !comparisonOrderConflict(selections, form.researchScope, form.order) &&
    selections.every((item) => item.kind !== 'keyword_suggestions' || form.seed.trim()),
  );
}

export function prepareReviewSelections(
  selections: DatasetSelection[],
  controls: {
    seed: string;
    grouping: 'as_is' | 'one_per_domain';
    order: DatasetSelection['order'];
    minVolume: string;
  },
): DatasetSelection[] {
  return selections.map((selection) => {
    if (selection.kind === 'backlinks') return { ...selection, grouping: controls.grouping };
    if (!KEYWORD_DATASET_KINDS.includes(selection.kind)) return selection;
    return {
      ...selection,
      ...(selection.kind === 'keyword_suggestions' ? { seed: controls.seed } : {}),
      order: controls.order,
      min_volume: controls.minVolume === '' ? undefined : Number(controls.minVolume),
    };
  });
}
