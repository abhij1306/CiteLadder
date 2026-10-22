import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { robotsHistoryPageSchema } from '@citeladder/contracts/site-health';
import type { z } from 'zod';
import { FileText } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { DisplayTime } from '@/components/ui/display-time';
import { Stack } from '@/components/ui/layout';
import { LineDiff } from '@/components/ui/line-diff';
import { QueryState } from '@/components/ui/query-state';
import { Select } from '@/components/ui/select';
import { TableCell, TableRow } from '@/components/ui/table';
import { textRole } from '@/components/ui/typography';
import { diffLines } from '@/lib/agent/diff';
import { siteHealthQueries } from '@/lib/api/site-health';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatDisplayTimestamp } from '@/lib/format';
import { crawlerPolicyLabels, robotsStatusLabels } from '@/lib/site-health/site-facts';
import { cursorControls, useCursorTable } from '@/lib/table/use-cursor-table';

type RobotsHistoryPage = z.infer<typeof robotsHistoryPageSchema>;

export function RobotsHistory({
  workspaceId,
  projectId,
}: Readonly<{
  workspaceId: string;
  projectId: string;
}>) {
  const pager = useCursorTable(projectId);
  const query = useQuery(siteHealthQueries.robotsHistory(workspaceId, projectId, pager.cursor));
  if (query.isPending)
    return <QueryState kind="loading" label="Loading robots.txt observations…" />;
  if (query.isError)
    return (
      <QueryState
        kind="error"
        error={query.error}
        fallback="robots.txt history is unavailable."
        onRetry={() => void query.refetch()}
        pending={query.isFetching}
      />
    );
  const page = query.data;
  return (
    <Stack>
      <DataTable
        label="robots.txt observation sequence"
        columns={COLUMNS}
        minWidth="md"
        state={
          page.items.length === 0
            ? {
                kind: 'empty',
                icon: FileText,
                headingLevel: 3,
                heading: 'No robots.txt observations are available.',
              }
            : undefined
        }
        pager={cursorControls(pager, page.next_cursor)}
      >
        {page.items.map((item) => (
          <TableRow key={item.crawl_id}>
            <TableCell numeric>
              <DisplayTime value={item.robots.observed_at} />
            </TableCell>
            <TableCell>{robotsStatusLabels[item.robots.status]}</TableCell>
            <TableCell>
              {item.robots.bots
                .map((bot) => `${bot.label}: ${crawlerPolicyLabels[bot.policy]}`)
                .join('; ')}
            </TableCell>
            <TableCell>{item.robots.robots_snapshot_id ?? 'No body observed'}</TableCell>
          </TableRow>
        ))}
      </DataTable>
      {/* A new page offers different observations, so the comparison starts over. */}
      <RobotsCompare key={pager.cursor ?? 'first'} page={page} />
    </Stack>
  );
}

const COLUMNS: readonly DataTableColumn[] = [
  { key: 'observed', label: 'Observed', width: 'date', numeric: true },
  { key: 'status', label: 'Fetch status', width: 'status' },
  { key: 'policy', label: 'Policy' },
  { key: 'snapshot', label: 'Snapshot', width: 'name' },
];

function RobotsCompare({ page }: Readonly<{ page: RobotsHistoryPage }>) {
  const timeZone = useDisplayTimeZone();
  const [selected, setSelected] = useState({ before: '', after: '' });
  const snapshots = new Map(page.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const versions = page.items.flatMap((item) =>
    item.robots.robots_snapshot_id
      ? [
          {
            value: item.crawl_id,
            label: formatDisplayTimestamp(item.robots.observed_at, timeZone),
            snapshot: snapshots.get(item.robots.robots_snapshot_id),
          },
        ]
      : [],
  );
  const options = versions.map(({ value, label }) => ({ value, label }));
  const before = versions.find((version) => version.value === selected.before)?.snapshot;
  const after = versions.find((version) => version.value === selected.after)?.snapshot;
  // The React Compiler memoizes this on the selected snapshots.
  const lines =
    before && after
      ? diffLines(before.body.replace(/\r\n?/gu, '\n'), after.body.replace(/\r\n?/gu, '\n'))
      : undefined;
  return (
    <>
      {(['before', 'after'] as const).map((side) => (
        <Select
          key={side}
          ariaLabel={`${side === 'before' ? 'Before' : 'After'} robots.txt observation`}
          value={selected[side]}
          onValueChange={(value) => setSelected((current) => ({ ...current, [side]: value }))}
          options={[{ value: '', label: `Select ${side} observation` }, ...options]}
        />
      ))}
      {before && after ? (
        <>
          <p className={textRole('caption')}>
            Lines removed since the Before observation and added in the After observation. Choose
            two observations on this page.
          </p>
          {lines ? (
            <LineDiff lines={lines} label="robots.txt line diff" />
          ) : (
            <p className={textRole('body')}>
              These robots.txt files are too long to compare line by line.
            </p>
          )}
        </>
      ) : null}
    </>
  );
}
