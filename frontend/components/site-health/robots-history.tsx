import { useState } from 'react';
import type { robotsHistoryPageSchema } from '@citeladder/contracts/site-health';
import type { z } from 'zod';
import { FileText } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { TableTime } from '@/components/ui/display-time';
import { choiceFilter } from '@/components/ui/all-filters';
import type { FilterBarProps } from '@/components/ui/filter-bar';
import { Stack } from '@/components/ui/layout';
import { LineDiff } from '@/components/ui/line-diff';
import { TableCell, TableRow } from '@/components/ui/table';
import { textRole } from '@/components/ui/typography';
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
/** The two observations chosen for comparison, on the page they were chosen from. */
type Selection = Readonly<{ page: string; before: string; after: string }>;

export function RobotsHistory({
  workspaceId,
  projectId,
}: Readonly<{
  workspaceId: string;
  projectId: string;
}>) {
  const timeZone = useDisplayTimeZone();
  // A page turn keeps the rows and the pager on screen until the next
  // observations land; loading and errors draw inside the table.
  const { page, cursor, table } = useCursorTableQuery({
    workspaceId,
    scopeId: projectId,
    scope: null,
    query: (request) => siteHealthQueries.robotsHistory({ workspaceId, projectId }, request),
    noun: 'observations',
    loading: 'Loading robots.txt observations…',
    error: 'robots.txt history is unavailable.',
    empty: () => ({
      kind: 'empty',
      icon: FileText,
      headingLevel: 3,
      heading: 'No robots.txt observations are available',
    }),
    fixedPageSize: ROBOTS_HISTORY_PAGE_SIZE,
  });
  // A new page offers different observations, so the comparison starts over.
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
  // The two observations to compare, in All filters; one observation has nothing to compare.
  const toolbar: FilterBarProps = {
    filters:
      versions.length < 2
        ? []
        : (['before', 'after'] as const).map((side) =>
            choiceFilter({
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
            }),
          ),
  };
  return (
    <Stack>
      <DataTable
        label="robots.txt observation sequence"
        columns={COLUMNS}
        minWidth="md"
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
      {/* One observation against itself has nothing to compare. */}
      {selected.before === selected.after ? null : (
        <RobotsDiff
          before={versions.find((version) => version.value === selected.before)?.snapshot}
          after={versions.find((version) => version.value === selected.after)?.snapshot}
        />
      )}
    </Stack>
  );
}

/**
 * What the observation captured. A stored body is content-addressed and
 * carries no time of its own, so the row's Observed time dates it.
 */
function snapshotSummary(snapshot: Snapshot | undefined): string {
  if (!snapshot) return 'No body observed';
  const size = pluralCount(snapshot.body.length, 'character');
  return snapshot.truncated ? `${size}, truncated` : size;
}

const COLUMNS: readonly DataTableColumn[] = [
  { key: 'observed', label: 'Observed', width: 'date' },
  { key: 'status', label: 'Fetch status', width: 'status' },
  { key: 'policy', label: 'Policy' },
  { key: 'snapshot', label: 'robots.txt body', width: 'name' },
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
      <p className={textRole('caption')}>
        Lines removed since the Before observation and added in the After observation. Choose two
        observations on this page.
      </p>
      {lines ? (
        <LineDiff lines={lines} label="robots.txt line diff" />
      ) : (
        <p className={textRole('body')}>
          These robots.txt files are too long to compare line by line.
        </p>
      )}
    </>
  );
}
