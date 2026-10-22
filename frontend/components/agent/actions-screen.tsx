'use client';

import { useQuery } from '@tanstack/react-query';
import { ActionStatusBadge } from '@/components/agent/action-status-badge';
import { PageShell } from '@/components/layout/page-shell';
import { ProjectRequiredState } from '@/components/layout/project-required-state';
import { Stack } from '@/components/ui/layout';
import { Pager } from '@/components/ui/pager';
import { QueryState } from '@/components/ui/query-state';
import { readErrorProps } from '@/components/ui/read-error';
import { Select } from '@/components/ui/select';
import { TextLink } from '@/components/ui/text-link';
import {
  ClampText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MissingValue } from '@/components/ui/unavailable-value';
import { textRole } from '@/components/ui/typography';
import {
  ACTION_STATUS_LABEL,
  ACTION_TARGET_KINDS,
  approachLabel,
  targetKindLabel,
} from '@/lib/agent/vocabulary';
import { actionsQueries, type Action, type ActionStatus } from '@/lib/api/actions';
import { actionStatusSchema } from '@citeladder/contracts/actions';
import { queueCount, useActionStatusCounts } from '@/lib/agent/use-action-status-counts';
import { ICONS } from '@/lib/icons';
import { stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { useProjectContext } from '@/lib/project/project-context';
import { cursorControls, pageRange, useCursorTable } from '@/lib/table/use-cursor-table';

const QUEUE = 'queue';
type StatusFilter = typeof QUEUE | ActionStatus;
const STATUS_FILTERS: readonly StatusFilter[] = [QUEUE, ...actionStatusSchema.options];
const STATUS_CODEC = stringUrlCodec<StatusFilter>(STATUS_FILTERS, QUEUE);
const ALL_TARGETS = 'all';
const TARGET_CODEC = stringUrlCodec<string>([ALL_TARGETS, ...ACTION_TARGET_KINDS], ALL_TARGETS);

type StatusCounts = Partial<Record<string, number>>;

function statusCount(value: StatusFilter, counts: StatusCounts) {
  return value === QUEUE ? queueCount(counts) : (counts[value] ?? 0);
}

/**
 * Status choices, each with its project-wide count. The counts cover every
 * target type, so they are shown only while the target filter is unset.
 */
function statusOptions(counts: StatusCounts | undefined) {
  return STATUS_FILTERS.map((value) => {
    const label = value === QUEUE ? 'Open and in progress' : ACTION_STATUS_LABEL[value];
    return { value, label: counts ? `${label} (${statusCount(value, counts)})` : label };
  });
}
const TARGET_OPTIONS = [
  { value: ALL_TARGETS, label: 'All targets' },
  ...ACTION_TARGET_KINDS.map((kind) => ({ value: kind, label: targetKindLabel(kind) ?? kind })),
];

/**
 * Actions ordered by deterministic priority. The filters are shareable URL
 * state; the cursor stack is local and resets whenever a filter changes.
 */
export function ActionsScreen() {
  const { activeProjectId, activeWorkspaceId, isLoading } = useProjectContext();
  const [status, setStatus] = useUrlState('status', STATUS_CODEC);
  const [target, setTarget] = useUrlState('target', TARGET_CODEC);
  const counts = useActionStatusCounts();
  return (
    <PageShell
      controls={{
        filters: (
          <>
            <Select
              ariaLabel="Status"
              value={status}
              options={statusOptions(target === ALL_TARGETS ? counts : undefined)}
              onValueChange={(value) => setStatus(value, 'replace')}
            />
            <Select
              ariaLabel="Target type"
              value={target}
              options={TARGET_OPTIONS}
              onValueChange={(value) => setTarget(value, 'replace')}
            />
          </>
        ),
      }}
    >
      {activeProjectId && activeWorkspaceId ? (
        <ActionsList
          workspaceId={activeWorkspaceId}
          projectId={activeProjectId}
          status={status === QUEUE ? undefined : status}
          targetKind={target === ALL_TARGETS ? undefined : target}
        />
      ) : (
        <ProjectRequired loading={isLoading} />
      )}
    </PageShell>
  );
}

function ProjectRequired({ loading }: Readonly<{ loading: boolean }>) {
  if (loading) return <QueryState kind="loading" />;
  return <ProjectRequiredState />;
}

function ActionsList({
  workspaceId,
  projectId,
  status,
  targetKind,
}: Readonly<{
  workspaceId: string;
  projectId: string;
  status?: ActionStatus;
  targetKind?: string;
}>) {
  const pager = useCursorTable(JSON.stringify([workspaceId, projectId, status, targetKind]));
  const query = useQuery(
    actionsQueries.list(workspaceId, projectId, {
      status,
      target_kind: targetKind,
      cursor: pager.cursor,
      limit: pager.pageSize,
    }),
  );

  if (query.isPending) return <QueryState kind="loading" label="Loading Actions…" />;
  if (query.isError)
    return (
      <QueryState kind="error" {...readErrorProps(query)} fallback="Actions could not be loaded." />
    );
  const page = query.data;
  if (page.items.length === 0) {
    const anyActions = Object.values(page.status_counts).some((count) => count > 0);
    return anyActions ? (
      <QueryState
        kind="empty"
        icon={ICONS.opportunities}
        heading="No Actions match these filters"
        description="Change the status or target type to see other Actions."
      />
    ) : (
      <QueryState
        kind="empty"
        icon={ICONS.opportunities}
        heading="No Actions yet"
        description="Actions appear when a crawl, visibility run or Search Console sync finds work on a target."
      />
    );
  }
  return (
    <Stack aria-busy={query.isFetching || undefined}>
      <ActionsTable actions={page.items} />
      <Pager
        range={{ ...pageRange(pager.page, pager.pageSize, page.items.length), noun: 'Actions' }}
        pageSize={{ value: pager.pageSize, onChange: pager.setPageSize }}
        {...cursorControls(pager, page.next_cursor)}
        busy={query.isFetching}
      />
    </Stack>
  );
}

function ActionsTable({ actions }: Readonly<{ actions: Action[] }>) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Target</TableHead>
          <TableHead>Status</TableHead>
          <TableHead numeric>Priority</TableHead>
          <TableHead numeric>Evidence systems</TableHead>
          <TableHead>Approach</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {actions.map((action) => (
          <TableRow key={action.id}>
            <TableCell>
              <div className="grid max-w-96 min-w-0">
                <ClampText lines={1} tooltip={action.target_label}>
                  <TextLink href={`/agent/actions/${action.id}`} text="itemTitle">
                    {action.target_label}
                  </TextLink>
                </ClampText>
                <ClampText lines={1} className={textRole('caption')}>
                  {[
                    targetKindLabel(action.target_kind),
                    action.origin === 'agent' ? 'From agent work' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </ClampText>
              </div>
            </TableCell>
            <TableCell>
              <ActionStatusBadge status={action.status} />
            </TableCell>
            <TableCell numeric>
              {action.priority_score === null ? (
                <MissingValue state="not_measured" reason="No evidence scores this target yet." />
              ) : (
                action.priority_score.toFixed(1)
              )}
            </TableCell>
            <TableCell numeric>{action.families.length}</TableCell>
            <TableCell>{approachLabel(action.approach) ?? ''}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
