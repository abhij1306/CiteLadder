import { useState } from 'react';
import type { robotsHistoryPageSchema } from '@citeladder/contracts/site-health';
import type { z } from 'zod';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { choiceFilter } from '@/components/ui/all-filters';
import type { FilterBarProps } from '@/components/ui/filter-bar';
import { FilterChip } from '@/components/ui/filter-chip';
import { Inline, Stack } from '@/components/ui/layout';
import { LineDiff } from '@/components/ui/line-diff';
import { TableCell, TableRow, TableTime } from '@/components/ui/table';
import { textRole } from '@/components/ui/typography';
import { FileText } from '@/lib/icons';
import { diffLines } from '@/lib/agent/diff';
import { siteHealthQueries } from '@/lib/api/site-health-queries';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatDisplayTimestamp, pluralCount } from '@/lib/format';
import { crawlerPolicyLabels, robotsStatusLabels } from '@/lib/site-health/site-facts';
import { ROBOTS_HISTORY_PAGE_SIZE } from '@/lib/config/site-health';
import { useCursorTableQuery } from '@/lib/table/use-cursor-table-query';

type RobotsHistoryPage = z.infer<typeof robotsHistoryPageSchema>;
type Snapshot = RobotsHistoryPage['snapshots'][number];
type Side = 'before' | 'after';
type Selection = Readonly<{ page: string; before: string; after: string }>;

export function RobotsHistory({
  workspaceId,
  projectId,
}: Readonly<{
  workspaceId: string;
  projectId: string;
}>) {
  const timeZone = useDisplayTimeZone();
  const { page, cursor, table } = useCursorTableQuery({
    workspaceId,
    scopeId: projectId,
    scope: null,
    query: (request) => siteHealthQueries.robotsHistory({ workspaceId, projectId }, request),
    noun: 'observations',
    loading: 'Loading robots.txt observations…',
    subject: 'the robots.txt history',
    empty: () => ({
      kind: 'empty',
      icon: FileText,
      headingLevel: 3,
      heading: 'No robots.txt observations are available',
    }),
    fixedPageSize: ROBOTS_HISTORY_PAGE_SIZE,
  });
  const pageKey = cursor.cursor ?? 'first';
  const [selection, setSelection] = useState<Selection>({ page: pageKey, before: '', after: '' });
  const selected =
    selection.page === pageKey ? selection : { page: pageKey, before: '', after: '' };
  const snapshots = new Map(page?.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const versions = (page?.items ?? []).flatMap((item) => {
    const snapshot = item.robots.robots_snapshot_id
      ? snapshots.get(item.robots.robots_snapshot_id)
      : undefined;
    return snapshot
      ? [
          {
            value: item.crawl_id,
            label: formatDisplayTimestamp(item.robots.observed_at, timeZone),
            snapshot,
          },
        ]
      : [];
  });
  const choose = (side: Side, value: string) => setSelection({ ...selected, [side]: value });
  const toolbar: FilterBarProps = {
    view:
      versions.length < 2 ? undefined : (
        <Inline className="flex-wrap">
          {(['before', 'after'] as const).map((side) => (
            <FilterChip
              key={side}
              filter={choiceFilter({
                id: side,
                label: side === 'before' ? 'Before' : 'After',
                value: selected[side],
                defaultValue: '',
                groups: [
                  {
                    options: [
                      { value: '', label: `Select ${side} observation` },
                      ...versions.map(({ value, label }) => ({ value, label })),
                    ],
                  },
                ],
                onChange: (value) => choose(side, value),
              })}
            />
          ))}
        </Inline>
      ),
  };
  return (
    <Stack>
      <DataTable
        label="robots.txt observation sequence"
        columns={COLUMNS}
        toolbar={toolbar}
        {...table}
      >
        {page?.items.map((item) => (
          <TableRow key={item.crawl_id}>
            <TableCell>
              <TableTime value={item.robots.observed_at} />
            </TableCell>
            <TableCell>{robotsStatusLabels[item.robots.status]}</TableCell>
            <TableCell>
              {item.robots.bots
                .map((bot) => `${bot.label}: ${crawlerPolicyLabels[bot.policy]}`)
                .join('; ')}
            </TableCell>
            <TableCell>
              {snapshotSummary(
                item.robots.robots_snapshot_id
                  ? snapshots.get(item.robots.robots_snapshot_id)
                  : undefined,
              )}
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
      {selected.before === selected.after ? null : (
        <RobotsDiff
          before={versions.find((version) => version.value === selected.before)?.snapshot}
          after={versions.find((version) => version.value === selected.after)?.snapshot}
        />
      )}
    </Stack>
  );
}

function snapshotSummary(snapshot: Snapshot | undefined): string {
  if (!snapshot) return 'No body observed';
  const size = pluralCount(snapshot.body.length, 'character');
  return snapshot.truncated ? `${size}, truncated` : size;
}

const COLUMNS: readonly DataTableColumn[] = [
  { key: 'observed', label: 'Observed', kind: 'date' },
  { key: 'status', label: 'Fetch status', kind: 'status' },
  { key: 'policy', label: 'Policy', kind: 'text' },
  { key: 'snapshot', label: 'robots.txt body', kind: 'text', width: 'name' },
];

function RobotsDiff({
  before,
  after,
}: Readonly<{ before: Snapshot | undefined; after: Snapshot | undefined }>) {
  if (!before || !after) return null;
  // The React Compiler memoizes this on the selected snapshots.
  const lines = diffLines(
    before.body.replace(/\r\n?/gu, '\n'),
    after.body.replace(/\r\n?/gu, '\n'),
  );
  return (
    <>
      {lines ? (
        <LineDiff lines={lines} label="robots.txt line diff" />
      ) : (
        <p className={textRole('body', 'text-ink-2')}>
          These robots.txt files are too long to compare line by line.
        </p>
      )}
    </>
  );
}
