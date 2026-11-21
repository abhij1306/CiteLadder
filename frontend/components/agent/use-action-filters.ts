import { choiceFilter, type FilterDefinition } from '@/components/ui/all-filters';
import {
  ACTION_FAMILIES,
  ACTION_STATUS_LABEL,
  IMPACT_LABEL,
  familyLabel,
} from '@/lib/agent/vocabulary';
import type {
  ActionPriorityBand,
  ActionStatus,
  ActionTreeFilters,
  ActionTreeGroupBy,
} from '@/lib/api/actions';
import { setUrlParams, stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { actionPriorityBandSchema, actionStatusSchema } from '@citeladder/contracts/actions';

const ALL = 'all';
export type StatusChoice = ActionStatus | typeof ALL;

export const STATUS_OPTIONS: readonly { value: StatusChoice; label: string }[] = [
  { value: ALL, label: 'All statuses' },
  ...actionStatusSchema.options.map((status) => ({
    value: status,
    label: ACTION_STATUS_LABEL[status],
  })),
];

export const GROUP_BY_OPTIONS = [
  { value: 'goal', label: 'Goal' },
  { value: 'what_to_do', label: 'What to do' },
  { value: 'impact', label: 'Impact' },
  { value: 'ownership', label: 'Owned vs earned' },
  { value: 'topic', label: 'Topics' },
] as const satisfies readonly { value: ActionTreeGroupBy; label: string }[];

const STATUS_CODEC = stringUrlCodec<StatusChoice>(
  STATUS_OPTIONS.map((option) => option.value),
  ALL,
);
const GROUP_BY_CODEC = stringUrlCodec<ActionTreeGroupBy>(
  GROUP_BY_OPTIONS.map((option) => option.value),
  'goal',
);
const IMPACT_CODEC = stringUrlCodec<ActionPriorityBand | typeof ALL>(
  [ALL, ...actionPriorityBandSchema.options],
  ALL,
);
const SOURCE_CODEC = stringUrlCodec<string>([ALL, ...ACTION_FAMILIES], ALL);

export function useActionFilters() {
  const [status, setStatus] = useUrlState('status', STATUS_CODEC, { history: 'replace' });
  const [groupBy, setGroupBy] = useUrlState('group_by', GROUP_BY_CODEC, { history: 'replace' });
  const [impact, setImpact] = useUrlState('impact', IMPACT_CODEC, { history: 'replace' });
  const [source, setSource] = useUrlState('source', SOURCE_CODEC, { history: 'replace' });
  const definitions: FilterDefinition[] = [
    choiceFilter<ActionPriorityBand | typeof ALL>({
      id: 'impact',
      label: 'Impact',
      value: impact,
      defaultValue: ALL,
      groups: [
        {
          options: [
            { value: ALL, label: 'Any impact' },
            ...actionPriorityBandSchema.options.map((band) => ({
              value: band,
              label: IMPACT_LABEL[band],
            })),
          ],
        },
      ],
      onChange: setImpact,
    }),
    choiceFilter<string>({
      id: 'source',
      label: 'Source',
      value: source,
      defaultValue: ALL,
      groups: [
        {
          options: [
            { value: ALL, label: 'All sources' },
            ...ACTION_FAMILIES.map((family) => ({
              value: family,
              label: familyLabel(family) ?? family,
            })),
          ],
        },
      ],
      onChange: setSource,
    }),
  ];
  const filters: ActionTreeFilters = {
    priority: impact === ALL ? undefined : impact,
    family: source === ALL ? undefined : source,
  };
  return {
    definitions,
    status,
    setStatus,
    statuses: status === ALL ? actionStatusSchema.options : [status],
    groupBy,
    setGroupBy,
    filters,
    filtered: impact !== ALL || source !== ALL,
    // Both filters back to every value in one write: a router navigation lands
    // later, so a setter per filter would build on the stale address.
    clear: () => setUrlParams({ impact: null, source: null }, 'replace'),
  };
}
