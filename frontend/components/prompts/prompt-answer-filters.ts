import type { PromptAnswerSearch } from '@citeladder/contracts';
import { rangeFilter, singleFilter, type FilterDefinition } from '@/components/ui/all-filters';
import { engineOptionMark } from '@/components/ui/engine-mark';
import type { PromptAnswerParams } from '@/lib/api/runs';
import { optionalStringUrlCodec, stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useEngineCatalog } from '@/lib/providers/engines';
import { RANGE_OPTIONS, rangeToFrom, type TrendRange } from '@/lib/visibility/trends';

const PERIOD = stringUrlCodec<TrendRange>(
  RANGE_OPTIONS.map((option) => option.value),
  '90d',
);
const CITED = stringUrlCodec(['any', 'cited', 'not_cited'] as const, 'any');
const SEARCH = stringUrlCodec(['any', 'used', 'not_used', 'not_reported'] as const, 'any');

const SEARCH_OPTIONS: readonly { value: PromptAnswerSearch; label: string }[] = [
  { value: 'used', label: 'Yes' },
  { value: 'not_used', label: 'No' },
  { value: 'not_reported', label: 'Not reported' },
];

export function usePromptAnswerFilters({
  market,
  marketChoice,
}: Readonly<{
  market: string | null;
  marketChoice: FilterDefinition | null;
}>): Readonly<{
  engine: string | null;
  definitions: FilterDefinition[];
  answers: PromptAnswerParams;
}> {
  const catalog = useEngineCatalog();
  const { project } = useProjectScope();
  const [engine, setEngine] = useUrlState('engine', optionalStringUrlCodec);
  const [period, setPeriod] = useUrlState('period', PERIOD);
  const [brand, setBrand] = useUrlState('brand', optionalStringUrlCodec);
  const [cited, setCited] = useUrlState('cited', CITED);
  const [search, setSearch] = useUrlState('search', SEARCH);
  const roster = [project.brand_name, ...project.competitors.map((c) => c.name)];
  return {
    engine,
    definitions: [
      rangeFilter({
        value: period,
        defaultValue: '90d',
        options: RANGE_OPTIONS,
        onChange: setPeriod,
      }),
      singleFilter({
        id: 'engine',
        label: 'Engine',
        icon: 'engines',
        allLabel: 'All engines',
        value: engine,
        options: catalog.order.map((key) => ({
          value: key,
          label: catalog.label(key),
          mark: engineOptionMark(key),
        })),
        onChange: setEngine,
      }),
      ...(marketChoice ? [marketChoice] : []),
      singleFilter({
        id: 'brand',
        label: 'Brand named',
        allLabel: 'Any',
        value: brand,
        options: [...new Set(roster.filter(Boolean))].map((name) => ({ value: name, label: name })),
        onChange: setBrand,
      }),
      singleFilter({
        id: 'cited',
        label: 'Cited',
        allLabel: 'Any',
        value: cited === 'any' ? null : cited,
        options: [
          { value: 'cited', label: 'Cited' },
          { value: 'not_cited', label: 'Not cited' },
        ],
        onChange: (next) => setCited(next === 'cited' || next === 'not_cited' ? next : 'any'),
      }),
      singleFilter({
        id: 'search',
        label: 'Search used',
        allLabel: 'Any',
        value: search === 'any' ? null : search,
        options: SEARCH_OPTIONS,
        onChange: (next) => setSearch(SEARCH_OPTIONS.find((o) => o.value === next)?.value ?? 'any'),
      }),
    ],
    answers: {
      market: market ?? undefined,
      engine: engine ?? undefined,
      from: rangeToFrom(period),
      brand: brand ?? undefined,
      cited: cited === 'any' ? undefined : cited === 'cited',
      search: search === 'any' ? undefined : search,
    },
  };
}
