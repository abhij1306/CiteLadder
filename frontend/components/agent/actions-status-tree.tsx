import { GroupingRows } from '@/components/agent/actions-rows';
import { useStatusTree } from '@/components/agent/use-actions-page';
import { Checkbox } from '@/components/ui/checkbox';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { StatusMark } from '@/components/ui/status-mark';
import {
  TreeGroupingRow,
  TreeGroupRow,
  TreeIndent,
  TreeLeaf,
  TreeLine,
  TreeLoading,
  TreeQuiet,
  TreeStatusRow,
} from '@/components/ui/work-tree';
import type { StateDotTone } from '@/components/ui/state-dot';
import type { GroupingRef, TreeGroup, TreeGrouping } from '@/lib/agent/action-tree';
import { ACTION_GROUPING_LABEL, ACTION_STATUS_LABEL, treeGroupLabel } from '@/lib/agent/vocabulary';
import type { ActionStatus, ActionTree } from '@/lib/api/actions';
import { formatCount } from '@/lib/format';

import { useActionsPageContext } from './actions-page-context';

export const levelKey = {
  status: (status: ActionStatus) => `s:${status}`,
  group: (status: ActionStatus, group: string) => `g:${status}:${group}`,
  grouping: (status: ActionStatus, group: string, grouping: string) =>
    `x:${status}:${group}:${grouping}`,
};

export const groupAnchor = (status: ActionStatus, group: string) => `actions-${status}-${group}`;

const TONE: Record<ActionStatus, StateDotTone> = {
  open: 'open',
  in_progress: 'active',
  done: 'done',
  dismissed: 'declined',
};

const EMPTY: Record<ActionStatus, string> = {
  open: 'No new actions',
  in_progress: 'No actions in progress',
  done: 'No actions done yet',
  dismissed: 'No declined actions',
};

export function StatusSection({
  status,
  count,
}: Readonly<{ status: ActionStatus; count: number | undefined }>) {
  const { scope, view, levels } = useActionsPageContext();
  const open = levels.isOpen(levelKey.status(status));
  const tree = useStatusTree(scope, view, status, open);
  const shown = count === undefined ? '' : formatCount(count);
  return (
    <section aria-label={ACTION_STATUS_LABEL[status]}>
      <TreeStatusRow
        open={open}
        tone={TONE[status]}
        name={ACTION_STATUS_LABEL[status]}
        count={shown}
        aria-label={[ACTION_STATUS_LABEL[status], shown].filter(Boolean).join(', ')}
        onClick={() => levels.toggle(levelKey.status(status))}
      />
      {open ? <StatusBody status={status} tree={tree} /> : null}
    </section>
  );
}

function StatusBody({
  status,
  tree,
}: Readonly<{ status: ActionStatus; tree: ReturnType<typeof useStatusTree> }>) {
  if (tree.data)
    return tree.data.groups.length === 0 ? (
      <TreeQuiet>{EMPTY[status]}</TreeQuiet>
    ) : (
      tree.data.groups.map((group) => (
        <GroupSection key={group.key} status={status} group={group} tree={tree.data} />
      ))
    );
  if (tree.isError)
    return (
      <TreeIndent>
        <Notice
          kind="read"
          {...readErrorProps(tree)}
          title="Couldn't load these actions"
          fallback="This status's actions could not be loaded."
        />
      </TreeIndent>
    );
  return <TreeLoading label="Loading actions…" />;
}

function GroupSection({
  status,
  group,
  tree,
}: Readonly<{ status: ActionStatus; group: TreeGroup; tree: ActionTree }>) {
  const { levels } = useActionsPageContext();
  const key = levelKey.group(status, group.key);
  const open = levels.isOpen(key);
  const label = treeGroupLabel(tree.group_by, group.key);
  const blocking =
    status === 'open' &&
    tree.group_by === 'goal' &&
    tree.goals.some((goal) => goal.goal === group.key && goal.blocking);
  return (
    <TreeIndent>
      <TreeGroupRow
        id={groupAnchor(status, group.key)}
        data-tree-group=""
        open={open}
        name={label}
        count={group.count}
        mark={
          blocking ? (
            <StatusMark variant="severity" value="critical">
              Blocking
            </StatusMark>
          ) : null
        }
        aria-label={`${label}, ${formatCount(group.count)}${blocking ? ', blocking' : ''}`}
        onClick={() => levels.toggle(key)}
      />
      {open ? (
        <TreeLine>
          {group.groupings.map((grouping) => (
            <GroupingSection
              key={grouping.grouping}
              refOf={{ status, groupKey: group.key, grouping: grouping.grouping }}
              grouping={grouping}
            />
          ))}
        </TreeLine>
      ) : null}
    </TreeIndent>
  );
}

function GroupingSection({
  refOf,
  grouping,
}: Readonly<{ refOf: GroupingRef; grouping: TreeGrouping }>) {
  const { levels, selection } = useActionsPageContext();
  const key = levelKey.grouping(refOf.status, refOf.groupKey, refOf.grouping);
  const open = levels.isOpen(key);
  const label = ACTION_GROUPING_LABEL[grouping.grouping];
  const some = selection.hasRowIn(refOf);
  const whole = selection.hasGrouping(refOf);
  return (
    <div>
      <TreeGroupingRow
        open={open}
        name={label}
        count={grouping.count}
        aria-label={`${label}, ${formatCount(grouping.count)}`}
        onClick={() => levels.toggle(key)}
        tick={
          <Checkbox
            aria-label={`Select every action in ${label}`}
            checked={whole || (some && 'indeterminate')}
            onCheckedChange={() => selection.toggleGrouping(refOf, grouping.count)}
          />
        }
      />
      {open ? (
        <TreeLeaf>
          <GroupingRows refOf={refOf} grouping={grouping} />
        </TreeLeaf>
      ) : null}
    </div>
  );
}
