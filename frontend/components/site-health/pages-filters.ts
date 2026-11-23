import { useQuery } from '@tanstack/react-query';

import { choiceFilter, type FilterDefinition } from '@/components/ui/all-filters';
import type { PageFilterParams, PageScoreRole } from '@/lib/api/site-health';
import { siteHealthQueries } from '@/lib/api/site-health-queries';
import { ISSUE_FILTER_OPTION_LIMIT } from '@/lib/config/site-health';
import { stringUrlCodec, useUrlState, type UrlCodec } from '@/lib/navigation/url-state';
import { issueTitle } from '@/lib/site-health/issues';
import { isSiteLevelRule } from '@/lib/site-health/site-level-evidence';

export const PAGES_FILTER_URL_KEYS = [
  'pages_rule',
  'pages_indexable',
  'pages_depth',
  'pages_score',
] as const;

const INDEXABLE = [
  { value: '', label: 'All pages' },
  { value: 'yes', label: 'Indexable' },
  { value: 'no', label: 'Not indexable' },
] as const;
type IndexableChoice = (typeof INDEXABLE)[number]['value'];

const DEPTHS = [
  { value: '', label: 'All depths', min_depth: undefined, max_depth: undefined },
  { value: '0-1', label: '0–1 clicks', min_depth: 0, max_depth: 1 },
  { value: '2-3', label: '2–3 clicks', min_depth: 2, max_depth: 3 },
  { value: '4+', label: '4+ clicks', min_depth: 4, max_depth: undefined },
] as const;
type DepthChoice = (typeof DEPTHS)[number]['value'];

const SCORE_BANDS: ReadonlyArray<{
  value: string;
  label: string;
  score_role?: PageScoreRole;
  max_score?: number;
}> = [
  { value: '', label: 'All scores' },
  {
    value: 'web_fundamentals:49',
    label: 'Web fundamentals below 50',
    score_role: 'web_fundamentals',
    max_score: 49,
  },
  {
    value: 'web_fundamentals:79',
    label: 'Web fundamentals below 80',
    score_role: 'web_fundamentals',
    max_score: 79,
  },
  {
    value: 'aeo_readiness:49',
    label: 'AEO readiness below 50',
    score_role: 'aeo_readiness',
    max_score: 49,
  },
  {
    value: 'aeo_readiness:79',
    label: 'AEO readiness below 80',
    score_role: 'aeo_readiness',
    max_score: 79,
  },
];

const RULE_CODEC: UrlCodec<string> = {
  parse: (raw) => raw ?? '',
  serialize: (value) => value || null,
};
const INDEXABLE_CODEC = stringUrlCodec<IndexableChoice>(
  INDEXABLE.map((choice) => choice.value),
  '',
);
const DEPTH_CODEC = stringUrlCodec<DepthChoice>(
  DEPTHS.map((choice) => choice.value),
  '',
);
const SCORE_CODEC = stringUrlCodec<string>(
  SCORE_BANDS.map((band) => band.value),
  '',
);

export function usePagesFilterState() {
  const [rule, setRule] = useUrlState(PAGES_FILTER_URL_KEYS[0], RULE_CODEC);
  const [indexable, setIndexable] = useUrlState(PAGES_FILTER_URL_KEYS[1], INDEXABLE_CODEC);
  const [depth, setDepth] = useUrlState(PAGES_FILTER_URL_KEYS[2], DEPTH_CODEC);
  const [score, setScore] = useUrlState(PAGES_FILTER_URL_KEYS[3], SCORE_CODEC);
  return { rule, setRule, indexable, setIndexable, depth, setDepth, score, setScore };
}

type PagesFilterState = ReturnType<typeof usePagesFilterState>;

export function pagesFilterParams(
  state: Pick<PagesFilterState, 'rule' | 'indexable' | 'depth' | 'score'>,
): PageFilterParams {
  const depth = DEPTHS.find((choice) => choice.value === state.depth);
  const band = SCORE_BANDS.find((choice) => choice.value === state.score);
  return {
    rule: state.rule || undefined,
    indexable: state.indexable === '' ? undefined : state.indexable === 'yes',
    min_depth: depth?.min_depth,
    max_depth: depth?.max_depth,
    score_role: band?.score_role,
    max_score: band?.max_score,
  };
}

export function usePagesFilters({
  workspaceId,
  crawlId,
  indexableFixed,
}: Readonly<{
  workspaceId: string;
  crawlId: string;
  indexableFixed: boolean;
}>): FilterDefinition[] {
  const state = usePagesFilterState();
  const { data } = useQuery(
    siteHealthQueries.issues(workspaceId, crawlId, { limit: ISSUE_FILTER_OPTION_LIMIT }),
  );
  const rules = new Map(
    (data?.items ?? [])
      .filter((issue) => !isSiteLevelRule(issue.rule_id))
      .map((issue) => [issue.rule_id, issueTitle(issue)]),
  );
  if (state.rule && !rules.has(state.rule)) rules.set(state.rule, state.rule);
  return [
    choiceFilter({
      id: 'rule',
      label: 'Issue',
      value: state.rule,
      defaultValue: '',
      searchable: true,
      onChange: state.setRule,
      groups: [
        {
          options: [
            { value: '', label: 'All issues' },
            ...[...rules].map(([value, label]) => ({ value, label })),
          ],
        },
      ],
    }),
    ...(indexableFixed
      ? []
      : [
          choiceFilter({
            id: 'indexable',
            label: 'Indexable',
            value: state.indexable,
            defaultValue: '',
            onChange: state.setIndexable,
            groups: [{ options: INDEXABLE }],
          }),
        ]),
    choiceFilter({
      id: 'depth',
      label: 'Depth',
      value: state.depth,
      defaultValue: '',
      onChange: state.setDepth,
      groups: [{ options: DEPTHS }],
    }),
    choiceFilter({
      id: 'score',
      label: 'Score',
      value: state.score,
      defaultValue: '',
      onChange: state.setScore,
      groups: [{ options: SCORE_BANDS }],
    }),
  ];
}
