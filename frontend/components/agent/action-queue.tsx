import { ActionStatusBadge } from '@/components/agent/action-status-badge';
import { choiceFilter, type FilterDefinition } from '@/components/ui/all-filters';
import type { DataTableState } from '@/components/ui/data-table';
import { Inline, Stack } from '@/components/ui/layout';
import { ClampText, TableCell } from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import {
  ACTION_APPROACHES,
  ACTION_FAMILIES,
  ACTION_GROUP_LABEL,
  ACTION_STATUS_LABEL,
  ACTION_TARGET_KINDS,
  PRIORITY_BAND_LABEL,
  approachLabel,
  familyLabel,
  targetKindLabel,
} from '@/lib/agent/vocabulary';
import {
  actionsQueries,
  type Action,
  type ActionGroup,
  type ActionsPage,
  type ActionsParams,
  type ActionStatus,
} from '@/lib/api/actions';
import { pluralCount, readableUrl } from '@/lib/format';
import { stringUrlCodec, useUrlState, type UrlCodec } from '@/lib/navigation/url-state';
import { useCursorTableQuery } from '@/lib/table/use-cursor-table-query';
import {
  actionGroupSchema,
  actionPriorityBandSchema,
  actionStatusSchema,
} from '@citeladder/contracts/actions';

/**
 * The Actions list's parts: its filters in the URL (one All filters menu,
 * AS6), the cursor-paged read of the project's Actions and the target cell.
 */

const QUEUE = 'queue';
const ALL = 'all';
type StatusFilter = typeof QUEUE | ActionStatus;
const STATUS_FILTERS: readonly StatusFilter[] = [QUEUE, ...actionStatusSchema.options];

/** The list's read, less its group: the grouped view asks once per group. */
export type ActionListQuery = Omit<ActionsParams, 'cursor' | 'limit' | 'group'>;

type Choice<T extends string> = Readonly<{ value: T; label: string }>;

/** One `all`-or-a-value filter: its URL codec and its All filters entry. */
function allOr<T extends string>(values: readonly T[]): UrlCodec<T | typeof ALL> {
  return stringUrlCodec<T | typeof ALL>([ALL, ...values], ALL);
}

const GROUP_CODEC = allOr(actionGroupSchema.options);
const APPROACH_CODEC = allOr(ACTION_APPROACHES);
const PRIORITY_CODEC = allOr(actionPriorityBandSchema.options);
const TARGET_CODEC = allOr(ACTION_TARGET_KINDS);
const SOURCE_CODEC = allOr(ACTION_FAMILIES);
const STATUS_CODEC = stringUrlCodec<StatusFilter>(STATUS_FILTERS, QUEUE);

function allFilter<T extends string>({
  id,
  label,
  allLabel,
  value,
  options,
  onChange,
}: Readonly<{
  id: string;
  label: string;
  allLabel: string;
  value: T | typeof ALL;
  options: readonly Choice<T>[];
  onChange: (value: T | typeof ALL) => void;
}>): FilterDefinition {
  return choiceFilter<T | typeof ALL>({
    id,
    label,
    value,
    defaultValue: ALL,
    groups: [{ options: [{ value: ALL, label: allLabel }, ...options] }],
    onChange,
  });
}

const labelled = <T extends string>(values: readonly T[], label: (value: T) => string | null) =>
  values.map((value) => ({ value, label: label(value) ?? value }));

/**
 * The Actions list's filters, every one URL state: Status (the work queue by
 * default), Group, Action type, Priority, Target type and Source. `query` is
 * the read they select, less the group; `group` is the one group the list is
 * narrowed to, if any, and `showGroup` narrows it (Show all N).
 */
export function useActionFilters() {
  const [status, setStatus] = useUrlState('status', STATUS_CODEC, { history: 'replace' });
  const [group, setGroup] = useUrlState('group', GROUP_CODEC, { history: 'replace' });
  const [approach, setApproach] = useUrlState('approach', APPROACH_CODEC, { history: 'replace' });
  const [priority, setPriority] = useUrlState('priority', PRIORITY_CODEC, { history: 'replace' });
  const [target, setTarget] = useUrlState('target', TARGET_CODEC, { history: 'replace' });
  const [source, setSource] = useUrlState('source', SOURCE_CODEC, { history: 'replace' });
  const definitions: FilterDefinition[] = [
    choiceFilter<StatusFilter>({
      id: 'status',
      label: 'Status',
      value: status,
      defaultValue: QUEUE,
      groups: [
        {
          options: STATUS_FILTERS.map((value) => ({
            value,
            label: value === QUEUE ? 'Open and in progress' : ACTION_STATUS_LABEL[value],
          })),
        },
      ],
      onChange: setStatus,
    }),
    allFilter({
      id: 'group',
      label: 'Group',
      allLabel: 'All groups',
      value: group,
      options: labelled(actionGroupSchema.options, (value) => ACTION_GROUP_LABEL[value]),
      onChange: setGroup,
    }),
    allFilter({
      id: 'approach',
      label: 'Action type',
      allLabel: 'All action types',
      value: approach,
      options: labelled(ACTION_APPROACHES, approachLabel),
      onChange: setApproach,
    }),
    allFilter({
      id: 'priority',
      label: 'Priority',
      allLabel: 'All priorities',
      value: priority,
      options: labelled(actionPriorityBandSchema.options, (value) => PRIORITY_BAND_LABEL[value]),
      onChange: setPriority,
    }),
    allFilter({
      id: 'target',
      label: 'Target type',
      allLabel: 'All targets',
      value: target,
      options: labelled(ACTION_TARGET_KINDS, targetKindLabel),
      onChange: setTarget,
    }),
    allFilter({
      id: 'source',
      label: 'Source',
      allLabel: 'All sources',
      value: source,
      options: labelled(ACTION_FAMILIES, familyLabel),
      onChange: setSource,
    }),
  ];
  const query: ActionListQuery = {
    status: status === QUEUE ? undefined : status,
    approach: approach === ALL ? undefined : approach,
    priority: priority === ALL ? undefined : priority,
    target_kind: target === ALL ? undefined : target,
    family: source === ALL ? undefined : source,
  };
  return {
    definitions,
    query,
    group: group === ALL ? undefined : group,
    // A step into one group, so Back returns to every group.
    showGroup: (next: ActionGroup) => setGroup(next, 'push'),
  };
}

/**
 * A row's one-line work summary: what kind of target, how many findings
 * the Action groups and the areas they come from. The list read carries no
 * written summary, so it is built from those fields.
 */
function workSummary(action: Action): string {
  const findings = pluralCount(action.member_count, 'finding');
  const families = action.families.map(familyLabel).filter(Boolean).join(', ');
  return [
    targetKindLabel(action.target_kind),
    // An issue family is one finding; its reach is the pages it fails on.
    action.page_count === null ? null : pluralCount(action.page_count, 'page'),
    families ? `${findings} in ${families}` : findings,
    action.origin === 'agent' ? 'From agent work' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * A row's target cell: the target linked to its Action, its
 * status beside it only in the work queue and only when it is not Open (the
 * queue is nearly all Open), and the work summary under it.
 */
export function ActionTargetCell({
  action,
  status,
}: Readonly<{
  action: Action;
  /** The list's status filter; undefined for the work queue. */
  status: ActionStatus | undefined;
}>) {
  // A page to create is named by its topic, so the label is not always a URL.
  const label = readableUrl(action.target_label);
  return (
    <TableCell>
      {/* Title over its caption, one fact 4 apart, as `TableCellLines` binds them. */}
      <Stack gap="tight" className="min-w-0">
        <Inline>
          <ClampText lines={1} tooltip={label}>
            <TextLink href={`/agent/actions/${action.id}`} text="itemTitle">
              {label}
            </TextLink>
          </ClampText>
          {status === undefined && action.status !== 'open' ? (
            <ActionStatusBadge status={action.status} />
          ) : null}
        </Inline>
        <ClampText lines={1} className={textRole('caption')}>
          {workSummary(action)}
        </ClampText>
      </Stack>
    </TableCell>
  );
}

/**
 * The project's Actions as a cursor-paged table read, ordered by
 * deterministic priority. The cursor stack is local and resets whenever a
 * filter changes.
 */
export function useActionTable({
  workspaceId,
  projectId,
  query,
  group,
  noun,
  empty,
}: Readonly<{
  workspaceId: string;
  projectId: string;
  query: ActionListQuery;
  group?: ActionGroup;
  /** What the rows are, plural ("Actions"). */
  noun: string;
  empty: (page: ActionsPage) => DataTableState;
}>) {
  return useCursorTableQuery({
    workspaceId,
    scopeId: projectId,
    scope: [query, group],
    query: (request) =>
      actionsQueries.list({ workspaceId, projectId }, { ...query, group, ...request }),
    noun,
    loading: `Loading ${noun}…`,
    error: `${noun} could not be loaded.`,
    empty,
  });
}
