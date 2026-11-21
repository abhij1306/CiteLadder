import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useLocation } from 'react-router-dom';

import { GoalStrip } from '@/components/agent/actions-goal-strip';
import { ActionsPageContext, useActionsPageContext } from '@/components/agent/actions-page-context';
import { groupAnchor, levelKey, StatusSection } from '@/components/agent/actions-status-tree';
import { ActionsToolbar } from '@/components/agent/actions-toolbar';
import { useActionFilters } from '@/components/agent/use-action-filters';
import {
  useBulkDecision,
  useOpenLevels,
  useStatusTree,
  useTreeSelection,
} from '@/components/agent/use-actions-page';
import { ReportPage } from '@/components/templates/report-page';
import { Button, IconButton } from '@/components/ui/button';
import { Stack } from '@/components/ui/layout';
import { SelectionDock } from '@/components/ui/selection-dock';
import { textRole } from '@/components/ui/typography';
import { X } from '@/lib/icons';
import { listJumpSchema, type ListJump } from '@/lib/agent/action-crumbs';
import type { ActionStatus, ActionTree } from '@/lib/api/actions';
import { formatCount } from '@/lib/format';
import { useProjectScope } from '@/lib/project/active-project-scope';
import type { ActionGoal } from '@citeladder/contracts/actions';

export function ActionsScreen() {
  const scope = useProjectScope();
  const view = useActionFilters();
  const location = useLocation();
  const lead: ActionStatus = view.statuses.includes('open') ? 'open' : (view.statuses[0] ?? 'open');
  const primary = useStatusTree(scope, view, lead);
  const [arrived] = useState(() => {
    const parsed = listJumpSchema.safeParse(location.state);
    return parsed.success && view.groupBy === 'goal' ? parsed.data : null;
  });
  const levels = useOpenLevels([...defaultOpen(lead, primary.data), ...jumpKeys(arrived)]);
  const selection = useTreeSelection(JSON.stringify([view.status, view.groupBy, view.filters]));
  const counts = primary.data?.status_counts;

  const pendingJump = useRef<ListJump | null>(arrived);
  const reveal = ({ status, goal }: ListJump) => {
    const row = document.getElementById(groupAnchor(status, goal));
    row?.scrollIntoView({ block: 'start' });
    row?.focus({ preventScroll: true });
    return row !== null;
  };
  useEffect(() => {
    const target = pendingJump.current;
    if (!target || primary.data?.group_by !== 'goal' || primary.isPlaceholderData) return;
    if (reveal(target)) pendingJump.current = null;
  });
  const jump = (goal: ActionGoal) => {
    const keys = [levelKey.status(lead), levelKey.group(lead, goal)];
    if (view.groupBy === 'goal') {
      flushSync(() => levels.open(keys));
      reveal({ status: lead, goal });
      return;
    }
    levels.open(keys);
    pendingJump.current = { status: lead, goal };
    view.setGroupBy('goal');
  };

  return (
    <ActionsPageContext value={{ scope, view, levels, selection }}>
      <ReportPage filters={<ActionsToolbar scope={scope} view={view} newCount={counts?.open} />}>
        <Stack gap="workspace" className="min-w-0">
          <Stack gap="tight">
            <h2 className={textRole('heading')}>Close the gaps keeping you out of AI answers</h2>
          </Stack>
          <GoalStrip goals={primary.data?.goals} failed={primary.isError} onJump={jump} />
          <div>
            {view.statuses.map((status) => (
              <StatusSection key={status} status={status} count={counts?.[status]} />
            ))}
          </div>
        </Stack>
        <BulkBar />
      </ReportPage>
    </ActionsPageContext>
  );
}

function jumpKeys(jump: ListJump | null): string[] {
  if (!jump) return [];
  return [
    levelKey.status(jump.status),
    levelKey.group(jump.status, jump.goal),
    ...(jump.grouping ? [levelKey.grouping(jump.status, jump.goal, jump.grouping)] : []),
  ];
}

function defaultOpen(status: ActionStatus, tree: ActionTree | undefined): string[] {
  const first = tree?.groups[0];
  const grouping = first?.groupings[0];
  return [
    levelKey.status(status),
    ...(first ? [levelKey.group(status, first.key)] : []),
    ...(first && grouping ? [levelKey.grouping(status, first.key, grouping.grouping)] : []),
  ];
}

function BulkBar() {
  const { scope, view, selection } = useActionsPageContext();
  const bulk = useBulkDecision(scope, view, selection);
  return (
    <SelectionDock
      label="Selected actions"
      summary={selection.size > 0 ? `${formatCount(selection.size)} selected` : null}
    >
      <Button variant="quiet" onClick={() => void bulk.decide('dismissed')} disabled={bulk.pending}>
        Decline
      </Button>
      <Button
        variant="primary"
        onClick={() => void bulk.decide('in_progress')}
        disabled={bulk.pending}
      >
        Accept
      </Button>
      <IconButton icon={X} label="Clear selection" onClick={selection.clear} />
    </SelectionDock>
  );
}
