import type { SearchDatasetSelectionRequest } from '@citeladder/contracts/search-intelligence-requests';
import type { ResearchScope, SearchIntelligenceReadiness } from '@/lib/api/search-intelligence';
import {
  SEARCH_DATASET_KINDS,
  searchDatasetKindsWith,
  type SearchDatasetKind,
} from '@citeladder/contracts/search-intelligence';
import { PRESET_OWNED_KINDS } from '@/lib/config/search-intelligence';
import { matchesCompetitor } from './search-intelligence-competitors';

export const selectionKey = (selection: SearchDatasetSelectionRequest) =>
  `${selection.kind}:${selection.competitor_id ?? ''}`;

function depthFor(data: SearchIntelligenceReadiness, kind: SearchDatasetKind) {
  return data.preferences.depths[kind] ?? 1;
}

export function reviewCompetitors(data: SearchIntelligenceReadiness): string[] {
  const all = data.competitors.map(({ identity }) => identity);
  const preferred = data.preferences.competitor_ids.filter((id) => all.includes(id));
  return [...preferred, ...all.filter((id) => !preferred.includes(id))];
}

export function reviewOwnedTarget(data: SearchIntelligenceReadiness) {
  return (
    data.owned_targets.find((target) => target.identity === data.preferences.owned_target_id) ??
    data.owned_targets[0]
  );
}

export function availableSelections(
  data: SearchIntelligenceReadiness,
): SearchDatasetSelectionRequest[] {
  return [
    ...searchDatasetKindsWith('owned').map((kind) => ({ kind, depth: depthFor(data, kind) })),
    ...reviewCompetitors(data).flatMap((competitor_id) =>
      searchDatasetKindsWith('competitor').map((kind) => ({
        kind,
        competitor_id,
        depth: depthFor(data, kind),
      })),
    ),
  ];
}

function saved(data: SearchIntelligenceReadiness, selection: SearchDatasetSelectionRequest) {
  const owned = reviewOwnedTarget(data)?.origin;
  const competitor = data.competitors.find((item) => item.identity === selection.competitor_id);
  return data.datasets.some((dataset) => {
    if (dataset.dataset_kind !== selection.kind) return false;
    if (!competitor) return dataset.target_origin === owned && !dataset.comparison_origin;
    if (SEARCH_DATASET_KINDS[selection.kind].comparison)
      return (
        dataset.target_origin === owned &&
        matchesCompetitor(dataset.comparison_origin, competitor.registrable_domain)
      );
    return matchesCompetitor(dataset.target_origin, competitor.registrable_domain);
  });
}

export function defaultSelections(
  data: SearchIntelligenceReadiness,
  action: string,
): SearchDatasetSelectionRequest[] {
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
      ? competitor_id === first && SEARCH_DATASET_KINDS[kind].comparison
      : PRESET_OWNED_KINDS.includes(kind),
  );
}

/** Exact-host comparisons cannot be ordered by traffic or position; the API refuses them. */
export function comparisonOrderConflict(
  selections: SearchDatasetSelectionRequest[],
  researchScope: ResearchScope,
  order: SearchDatasetSelectionRequest['order'],
) {
  return (
    researchScope === 'exact_host' &&
    (order === 'traffic' || order === 'position') &&
    selections.some(({ kind }) => SEARCH_DATASET_KINDS[kind].comparison)
  );
}

/** Backlink history covers the whole domain; the API refuses it for an exact host. */
export function historyScopeConflict(
  selections: SearchDatasetSelectionRequest[],
  researchScope: ResearchScope,
) {
  return (
    researchScope === 'exact_host' && selections.some(({ kind }) => kind === 'backlink_history')
  );
}

export function reviewInputsValid(
  selections: SearchDatasetSelectionRequest[],
  form: {
    ownedTarget: string;
    location: string;
    seed: string;
    researchScope: ResearchScope;
    order: SearchDatasetSelectionRequest['order'];
  },
) {
  const marketNeeded = selections.some(({ kind }) => !SEARCH_DATASET_KINDS[kind].backlink);
  const location = Number(form.location);
  return Boolean(
    selections.length &&
    form.ownedTarget &&
    (!marketNeeded || (Number.isInteger(location) && location > 0)) &&
    !historyScopeConflict(selections, form.researchScope) &&
    !comparisonOrderConflict(selections, form.researchScope, form.order) &&
    selections.every((item) => !SEARCH_DATASET_KINDS[item.kind].seed || form.seed.trim()),
  );
}

export function prepareReviewSelections(
  selections: SearchDatasetSelectionRequest[],
  controls: {
    seed: string;
    grouping: 'as_is' | 'one_per_domain';
    order: SearchDatasetSelectionRequest['order'];
    minVolume: string;
  },
): SearchDatasetSelectionRequest[] {
  return selections.map((selection) => {
    if (selection.kind === 'backlinks') return { ...selection, grouping: controls.grouping };
    const kind = SEARCH_DATASET_KINDS[selection.kind];
    if (!kind.keyword) return selection;
    return {
      ...selection,
      ...(kind.seed ? { seed: controls.seed } : {}),
      order: controls.order,
      min_volume: controls.minVolume === '' ? undefined : Number(controls.minVolume),
    };
  });
}
