/**
 * Prompt search + filter model. Pure functions so the toolbar stays
 * presentational and filtering is unit-testable.
 */
import type { CitedDomain, NamedBrand, Prompt } from '@citeladder/contracts';

export type EnabledFilter = 'all' | 'enabled' | 'disabled';

export type PromptFilters = {
  intents: string[];
  stages: string[];
  personas: string[];
  brands: string[];
  sources: string[];
  enabled: EnabledFilter;
  branded: EnabledFilter;
};

export const emptyFilters: PromptFilters = {
  intents: [],
  stages: [],
  personas: [],
  brands: [],
  sources: [],
  enabled: 'all',
  branded: 'all',
};

export type PromptMentions = Readonly<{
  named: readonly Pick<NamedBrand, 'kind' | 'name'>[];
  sources: readonly CitedDomain[];
}>;

type FilterOption = Readonly<{ value: string; label: string }>;

const LEADING_SOURCES = 3;

export function personaOptions(prompts: readonly Prompt[]): string[] {
  return [...new Set(prompts.map((prompt) => prompt.persona).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function brandKey(brand: Pick<NamedBrand, 'kind' | 'name'>): string {
  if (brand.kind === 'brand') return 'brand';
  return `competitor:${brand.name.trim().replace(/\s+/gu, ' ').toLowerCase()}`;
}

export function brandOptions(project: {
  brand_name: string;
  competitors: readonly { name: string }[];
}): FilterOption[] {
  const options = new Map([['brand', project.brand_name]]);
  for (const { name } of project.competitors) {
    const key = brandKey({ kind: 'competitor', name });
    if (!options.has(key)) options.set(key, name);
  }
  return [...options].map(([value, label]) => ({ value, label }));
}

export function sourceOptions(
  mentions: Iterable<PromptMentions>,
  selected: readonly string[] = [],
): FilterOption[] {
  const totals = new Map<string, { citations: number; owned: boolean }>();
  for (const { sources } of mentions)
    for (const { domain, citations, owned } of sources) {
      const total = totals.get(domain);
      totals.set(domain, {
        citations: (total?.citations ?? 0) + citations,
        owned: Boolean(total?.owned) || owned,
      });
    }
  const cited = [...totals]
    .sort(([left, a], [right, b]) => b.citations - a.citations || left.localeCompare(right))
    .map(([domain, { owned }]) => ({ value: domain, label: owned ? `${domain} (yours)` : domain }));
  const stale = selected.filter((domain) => !totals.has(domain));
  return [...cited, ...stale.map((domain) => ({ value: domain, label: domain }))];
}

export function leadingSources(sources: readonly CitedDomain[]): {
  shown: readonly CitedDomain[];
  more: number;
} {
  return {
    shown: sources.slice(0, LEADING_SOURCES),
    more: Math.max(0, sources.length - LEADING_SOURCES),
  };
}

function matchesTriState(value: boolean, filter: EnabledFilter): boolean {
  if (filter === 'all') return true;
  return filter === 'enabled' ? value : !value;
}

function matchesAny(selected: ReadonlySet<string>, values: readonly string[] | undefined) {
  return selected.size === 0 || Boolean(values?.some((value) => selected.has(value)));
}

export function filterPrompts({
  prompts,
  search,
  filters,
  mentions,
}: Readonly<{
  prompts: Prompt[];
  search: string;
  filters: PromptFilters;
  mentions?: ReadonlyMap<string, PromptMentions>;
}>): Prompt[] {
  const needle = search.trim().toLowerCase();
  const intentSet = new Set(filters.intents);
  const stageSet = new Set(filters.stages);
  const personaSet = new Set(filters.personas);
  const brandSet = new Set(filters.brands);
  const sourceSet = new Set(filters.sources);
  const measured = mentions ?? new Map<string, PromptMentions>();
  return prompts.filter((prompt) => {
    if (needle) {
      const haystack = `${prompt.text} ${prompt.theme ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (intentSet.size > 0 && !intentSet.has(prompt.intent)) return false;
    if (stageSet.size > 0 && !stageSet.has(prompt.buyer_stage)) return false;
    if (personaSet.size > 0 && !personaSet.has(prompt.persona)) return false;
    if (!matchesTriState(prompt.enabled, filters.enabled)) return false;
    if (!matchesTriState(prompt.branded, filters.branded)) return false;
    return matchesMeasured(measured.get(prompt.id), { brands: brandSet, sources: sourceSet });
  });
}

function matchesMeasured(
  measured: PromptMentions | undefined,
  selected: Readonly<{ brands: ReadonlySet<string>; sources: ReadonlySet<string> }>,
): boolean {
  return (
    matchesAny(selected.brands, measured?.named.map(brandKey)) &&
    matchesAny(
      selected.sources,
      measured?.sources.map((source) => source.domain),
    )
  );
}
