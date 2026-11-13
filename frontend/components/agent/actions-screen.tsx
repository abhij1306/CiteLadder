import { Fragment, useState, type MouseEvent } from 'react';
import { useQueries } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import {
  ActionTargetCell,
  useActionFilters,
  useActionTable,
  type ActionListQuery,
} from '@/components/agent/action-queue';
import { ActionPriorityBadge } from '@/components/agent/action-status-badge';
import { AnalyzePageButton } from '@/components/agent/analyze-page-dialog';
import { ListScreen } from '@/components/layout/page-shell';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import { Icon } from '@/components/ui/icon';
import { readErrorProps } from '@/components/ui/read-error';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { ACTION_GROUP_LABEL, approachLabel, familyLabel } from '@/lib/agent/vocabulary';
import {
  actionsQueries,
  type Action,
  type ActionGroup,
  type ActionsPage,
  type ActionStatus,
} from '@/lib/api/actions';
import { formatCount } from '@/lib/format';
import { ICONS } from '@/lib/icons';
import { useProjectHref } from '@/lib/navigation/project-destination';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { actionGroupSchema } from '@citeladder/contracts/actions';

/**
 * Every Action of the project, content-gap work included, in the table it
 * has always had, its rows grouped (AS2): fix how AI reads your site, your own
 * pages, mentions elsewhere and your products. Each group shows its top
 * Actions by priority and "Show all N", which narrows the list to that group
 * and pages it. Every filter sits in one All filters menu (AS6) and is URL
 * state. Analyze a page in the header turns a content page into an Action (CO6).
 */
export function ActionsScreen() {
  const { workspaceId, projectId } = useProjectScope();
  const filters = useActionFilters();
  const scope = { workspaceId, projectId };
  return (
    <ListScreen narrow actions={<AnalyzePageButton />} controls={{ filters: filters.definitions }}>
      {filters.group ? (
        <GroupList {...scope} query={filters.query} group={filters.group} />
      ) : (
        <GroupedList {...scope} query={filters.query} onShowGroup={filters.showGroup} />
      )}
    </ListScreen>
  );
}

// No status column: under the default queue nearly every row is Open, so a
// row names its status beside the target only when it differs (owner,
// 2026-11-10).
const COLUMNS: readonly DataTableColumn[] = [
  { key: 'target', label: 'Action' },
  { key: 'priority', label: 'Priority', width: 'status' },
  { key: 'approach', label: 'Action type', width: 'name' },
  { key: 'source', label: 'Source', width: 'name' },
];

type ListProps = Readonly<{ workspaceId: string; projectId: string; query: ActionListQuery }>;

/** One group, narrowed by Show all or the Group filter: paged as the whole list was. */
function GroupList({ workspaceId, projectId, query, group }: ListProps & { group: ActionGroup }) {
  const { page, table } = useActionTable({
    workspaceId,
    projectId,
    query,
    group,
    noun: 'Actions',
    empty: emptyActions,
  });
  return (
    // Every row stacks the target over its kind, so short pages pad with
    // two-line blanks and the pager stays where a full page puts it.
    <DataTable label="Actions" columns={COLUMNS} rowLines={2} {...table}>
      {page?.items.map((action) => (
        <ActionRow key={action.id} action={action} status={query.status} />
      ))}
    </DataTable>
  );
}

/**
 * Every group under its header row: the group's top Actions by priority,
 * then "Show all N" when it holds more. A group with nothing under the
 * filters is left out. One read per group, at the preview size.
 */
function GroupedList({
  workspaceId,
  projectId,
  query,
  onShowGroup,
}: ListProps & { onShowGroup: (group: ActionGroup) => void }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<ActionGroup>>(new Set());
  const reads = useQueries({
    queries: actionsQueries.groupPreviews({ workspaceId, projectId }, query).map((read) => ({
      ...read,
      // A filter change keeps this project's rows on screen until the next land.
      placeholderData: (previous: ActionsPage | undefined, previousQuery?: { queryKey: unknown }) =>
        sameProject(previousQuery?.queryKey, workspaceId, projectId) ? previous : undefined,
    })),
  });
  const failed = reads.find((read) => read.isError);
  const counts = reads.find((read) => read.data)?.data;
  let state: DataTableState | undefined;
  if (reads.some((read) => read.isPending)) state = { kind: 'loading', label: 'Loading Actions…' };
  else if (failed)
    state = { kind: 'error', ...readErrorProps(failed), fallback: 'Actions could not be loaded.' };
  else if (counts && Object.values(counts.group_counts).every((count) => count === 0))
    state = emptyActions(counts);
  const toggle = (group: ActionGroup) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(group)) next.add(group);
      return next;
    });
  return (
    <DataTable
      label="Actions"
      columns={COLUMNS}
      rowLines={2}
      state={state}
      busy={{
        active: reads.some((read) => read.isFetching && !read.isPending),
        label: 'Loading Actions…',
      }}
    >
      {actionGroupSchema.options.map((group, index) => {
        const page = reads[index]?.data;
        const total = page?.group_counts[group] ?? 0;
        if (!page || total === 0) return null;
        const open = !collapsed.has(group);
        return (
          <Fragment key={group}>
            <GroupHeaderRow
              group={group}
              total={total}
              open={open}
              onToggle={() => toggle(group)}
            />
            {open
              ? page.items.map((action) => (
                  <ActionRow key={action.id} action={action} status={query.status} />
                ))
              : null}
            {open && total > page.items.length ? (
              <ShowAllRow group={group} total={total} onShow={() => onShowGroup(group)} />
            ) : null}
          </Fragment>
        );
      })}
    </DataTable>
  );
}

/** Whether a previous read was for this workspace's project, so its rows may stand in. */
function sameProject(key: unknown, workspaceId: string, projectId: string): boolean {
  return Array.isArray(key) && key.includes(workspaceId) && key.includes(projectId);
}

/**
 * A group's header row: its name and how many Actions it holds; it folds the
 * group's rows. It has no fill, so it never reads as part of the column
 * header's `surface-sunken` band above it: the row rule over it and its name
 * in ink at the button's medium weight set it apart from the rows it heads.
 */
function GroupHeaderRow({
  group,
  total,
  open,
  onToggle,
}: Readonly<{ group: ActionGroup; total: number; open: boolean; onToggle: () => void }>) {
  return (
    <TableRow data-action-group={group}>
      <TableCell colSpan={COLUMNS.length}>
        <Button
          variant="ghost"
          aria-expanded={open}
          aria-label={`${ACTION_GROUP_LABEL[group]}, ${formatCount(total)}`}
          onClick={onToggle}
        >
          <Icon icon={open ? ChevronDown : ChevronRight} />
          <span className="text-ink">{ACTION_GROUP_LABEL[group]}</span>
          <span className="text-ink-muted tabular-nums">{formatCount(total)}</span>
        </Button>
      </TableCell>
    </TableRow>
  );
}

/** The row after a group's preview: Show all N narrows the list to the group. */
function ShowAllRow({
  group,
  total,
  onShow,
}: Readonly<{ group: ActionGroup; total: number; onShow: () => void }>) {
  return (
    <TableRow>
      <TableCell colSpan={COLUMNS.length}>
        <Button
          variant="ghost"
          onClick={onShow}
          aria-label={`Show all ${formatCount(total)} in ${ACTION_GROUP_LABEL[group]}`}
        >
          Show all {formatCount(total)}
        </Button>
      </TableCell>
    </TableRow>
  );
}

/** What a page with no Actions says: nothing matches, or nothing exists yet. */
function emptyActions(page: ActionsPage): DataTableState {
  const anyActions = Object.values(page.status_counts).some((count) => count > 0);
  return anyActions
    ? {
        kind: 'empty',
        icon: ICONS.opportunities,
        headingLevel: 3,
        heading: 'No Actions match these filters',
        description: 'Change the filters to see other Actions.',
      }
    : {
        kind: 'empty',
        icon: ICONS.opportunities,
        headingLevel: 3,
        heading: 'No Actions yet',
        description:
          'Actions appear when a crawl, visibility run or Search Console sync finds work on a target.',
      };
}

/**
 * One Action. The whole row opens its detail page; the target link inside it
 * is the same destination for the keyboard and a screen reader.
 */
function ActionRow({
  action,
  status,
}: Readonly<{ action: Action; status: ActionStatus | undefined }>) {
  const navigate = useNavigate();
  const projectHref = useProjectHref();
  const href = `/agent/actions/${action.id}`;
  const open = (event: MouseEvent<HTMLTableRowElement>) => {
    // The link and any control in the row handle their own press.
    if (event.target instanceof Element && event.target.closest('a, button')) return;
    navigate(projectHref(href));
  };
  const sources = action.families.map(familyLabel).filter(Boolean).join(', ');
  return (
    <TableRow onClick={open} className="cursor-pointer">
      <ActionTargetCell action={action} status={status} />
      <TableCell className="whitespace-nowrap">
        <ActionPriorityBadge band={action.priority_band} />
      </TableCell>
      <TableCell>{approachLabel(action.approach) ?? ''}</TableCell>
      <TableCell>
        <ClampText lines={1} tooltip={sources}>
          {sources}
        </ClampText>
      </TableCell>
    </TableRow>
  );
}
