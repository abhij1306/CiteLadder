import { ClampText } from '@/components/ui/clamp-text';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Tag } from '@/components/ui/tag';
import { TextLink } from '@/components/ui/text-link';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { pageNumberControls, useResizableTablePage } from '@/components/ui/pager';
import { TableActionsCell, TableCell, TableCellLines, TableRow } from '@/components/ui/table';
import { Absence } from '@/components/ui/absence';
import { ChevronRight } from '@/lib/icons';
import type { DemandSignal } from '@/lib/api/demand';
import {
  numericMetric,
  signalPage,
  signalSubject,
  signalTarget,
  signalTypeMeta,
  type RankedSignal,
} from '@/lib/demand/signals';
import { formatCount, formatMean, formatPercent } from '@/lib/format';

const COLUMNS: readonly DataTableColumn[] = [
  { key: 'target', label: 'Query or page', kind: 'identity' },
  { key: 'signal', label: 'Signal', kind: 'status', width: 'category' },
  { key: 'impressions', label: 'Impressions', kind: 'number', width: 'figure' },
  { key: 'clicks', label: 'Clicks', kind: 'number', width: 'control', priority: 'low' },
  { key: 'ctr', label: 'CTR', kind: 'number', width: 'control' },
  { key: 'position', label: 'Position', kind: 'number', width: 'control' },
  { key: 'rank', label: 'Rank', kind: 'number', width: 'index', priority: 'low' },
  { key: 'open', label: 'Inspect', kind: 'actions', width: 'index' },
];

export const SIGNAL_COLUMN_COUNT = COLUMNS.length;

function SignalChip({ signalType }: Readonly<{ signalType: string }>) {
  return <Tag>{signalTypeMeta(signalType).label}</Tag>;
}

export function DemandSignalTable({
  rows,
  filterKey,
  onInspect,
  onClearFilters,
}: Readonly<{
  rows: readonly RankedSignal[];
  filterKey: string;
  onInspect: (signal: DemandSignal) => void;
  onClearFilters: () => void;
}>) {
  const { page, setPage, pageCount, from, to, pageSize, pageSizeControl } = useResizableTablePage(
    rows.length,
    { resetKey: filterKey, urlKey: 'page' },
  );

  const pageRows = rows.slice(from - 1, to);
  return (
    <DataTable
      title="Demand signals"
      columns={COLUMNS}
      state={
        rows.length === 0
          ? { kind: 'filtered', heading: 'No signals match your filter', onClear: onClearFilters }
          : undefined
      }
      rowCount={pageRows.length}
      pageSize={pageCount > 1 ? pageSize : undefined}
      pager={{
        range: { from, to, total: rows.length, noun: 'signals' },
        pageSize: pageSizeControl,
        ...pageNumberControls(page, pageCount, setPage),
      }}
    >
      {pageRows.map(({ signal, rank }) => (
        <SignalRow key={signal.id} signal={signal} rank={rank} onInspect={onInspect} />
      ))}
    </DataTable>
  );
}

function SignalRow({
  signal,
  rank,
  onInspect,
}: Readonly<{ signal: DemandSignal; rank: number; onInspect: (signal: DemandSignal) => void }>) {
  const subject = signalSubject(signal);
  const inspect = () => onInspect(signal);
  const inspectFromRow = () => {
    if (!window.getSelection()?.isCollapsed) return;
    inspect();
  };
  return (
    <TableRow
      tabIndex={0}
      aria-label={`Inspect evidence for ${signalTarget(signal)}`}
      onClick={inspectFromRow}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        inspect();
      }}
      className="focus-ring cursor-pointer"
    >
      <TableCell>
        <TableCellLines
          title
          primary={
            <TextLink asChild text="body" underline="hover">
              <Pressable
                className="flex w-auto max-w-full min-w-0 text-left"
                onClick={(event) => {
                  event.stopPropagation();
                  inspect();
                }}
              >
                <ClampText>{subject.primary}</ClampText>
              </Pressable>
            </TextLink>
          }
          secondary={subject.secondary}
          secondaryTooltip={signalPage(signal)}
        />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <SignalChip signalType={signal.signal_type} />
      </TableCell>
      <TableCell numeric>
        <Count value={numericMetric(signal, 'impressions')} />
      </TableCell>
      <TableCell numeric>
        <Count value={numericMetric(signal, 'clicks')} />
      </TableCell>
      <TableCell numeric>
        <Ctr signal={signal} />
      </TableCell>
      <TableCell numeric>
        <Position value={numericMetric(signal, 'position')} />
      </TableCell>
      <TableCell numeric>{rank}</TableCell>
      <TableActionsCell>
        <Icon icon={ChevronRight} className="text-ink-2" />
      </TableActionsCell>
    </TableRow>
  );
}

function Count({ value }: Readonly<{ value: number | null }>) {
  return value === null ? <Absence state="not_measured" /> : formatCount(value);
}

function Position({ value }: Readonly<{ value: number | null }>) {
  return value === null ? <Absence state="not_measured" /> : formatMean(value);
}

function Ctr({ signal }: Readonly<{ signal: DemandSignal }>) {
  const persisted = numericMetric(signal, 'ctr');
  if (persisted !== null) return formatPercent(persisted);
  const impressions = numericMetric(signal, 'impressions');
  const clicks = numericMetric(signal, 'clicks');
  if (impressions === null || clicks === null || impressions === 0)
    return <Absence state="not_measured" />;
  return formatPercent(clicks / impressions);
}
