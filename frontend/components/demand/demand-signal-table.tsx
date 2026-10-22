'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { ProjectLink } from '@/components/layout/scoped-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Icon } from '@/components/ui/icon';
import { Inline } from '@/components/ui/layout';
import { pageNumberControls, useTablePage } from '@/components/ui/pager';
import { TableActionsCell, TableCell, TableCellLines, TableRow } from '@/components/ui/table';
import { textRole } from '@/components/ui/typography';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { splitPaneClasses } from '@/components/ui/workspace';
import type { DemandSignal } from '@/lib/api/demand';
import { TABLE_DEFAULT_PAGE_SIZE, isTablePageSize, type TablePageSize } from '@/lib/config/tables';
import {
  demandSignalHandoffHref,
  numericMetric,
  signalPage,
  signalPageLine,
  signalTarget,
  signalTypeMeta,
  type RankedSignal,
} from '@/lib/demand/signals';
import { formatCount } from '@/lib/format';

const COLUMNS: readonly DataTableColumn[] = [
  { key: 'rank', label: 'Rank', width: 'index', numeric: true },
  { key: 'target', label: 'Query and page' },
  { key: 'signal', label: 'Signal', width: 'category' },
  { key: 'impressions', label: 'Impressions', width: 'figure', numeric: true },
  { key: 'clicks', label: 'Clicks', width: 'figure', numeric: true },
  { key: 'ctr', label: 'CTR', width: 'figure', numeric: true },
  { key: 'position', label: 'Avg. position', width: 'figure', numeric: true },
  { key: 'actions', label: 'Actions', width: 'rowActions', hideLabel: true },
];

/** A signal type as a labelled chip; its meaning lives in the legend. */
export function SignalChip({ signalType }: Readonly<{ signalType: string }>) {
  const meta = signalTypeMeta(signalType);
  return meta.tone === 'neutral' ? (
    <Badge>{meta.label}</Badge>
  ) : (
    <Badge variant="status" value={meta.tone}>
      {meta.label}
    </Badge>
  );
}

/** Each signal type present, explained once. */
export function SignalLegend({ signals }: Readonly<{ signals: readonly DemandSignal[] }>) {
  const types = [...new Set(signals.map((signal) => signal.signal_type))];
  if (types.length === 0) return null;
  return (
    <section aria-label="Signal types">
      <dl className={splitPaneClasses('peers')}>
        {types.map((type) => (
          <Inline key={type} className="items-start">
            <dt className="shrink-0">
              <SignalChip signalType={type} />
            </dt>
            <dd className={textRole('caption')}>{signalTypeMeta(type).definition}</dd>
          </Inline>
        ))}
      </dl>
    </section>
  );
}

/**
 * The signals, one flat row each in priority order, a page at a time. The
 * landing page rides under its query as a caption instead of a full-width
 * group row, so every row is a signal. Detail stays in the evidence drawer.
 *
 * The whole list is already in the persisted snapshot, so it pages on the
 * client. `filterKey` names the active filter: a new filter starts at page 1,
 * while a refetch of the same filter only clamps the page into range.
 */
export function DemandSignalTable({
  rows,
  filterKey,
  onInspect,
}: Readonly<{
  rows: readonly RankedSignal[];
  filterKey: string;
  onInspect: (signal: DemandSignal) => void;
}>) {
  const [pageSize, setPageSize] = useState<TablePageSize>(TABLE_DEFAULT_PAGE_SIZE);
  const { page, setPage, pageCount, from, to } = useTablePage(rows.length, pageSize);
  const [pagedFilter, setPagedFilter] = useState(filterKey);
  if (pagedFilter !== filterKey) {
    setPagedFilter(filterKey);
    setPage(1);
  }

  const pageRows = rows.slice(from - 1, to);
  // Paging never moves the layout: a short last page keeps a full page's
  // height (a single page just ends).
  return (
    <DataTable
      label="Search demand signals"
      columns={COLUMNS}
      minWidth="lg"
      rowLines={2}
      rowCount={pageRows.length}
      pageSize={pageCount > 1 ? pageSize : undefined}
      pager={{
        range: { from, to, total: rows.length, noun: 'signals' },
        pageSize: {
          value: pageSize,
          onChange: (size) => {
            setPageSize(isTablePageSize(size) ? size : TABLE_DEFAULT_PAGE_SIZE);
            setPage(1);
          },
        },
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
  const target = signalTarget(signal);
  return (
    <TableRow>
      <TableCell numeric className={textRole('caption')}>
        {rank}
      </TableCell>
      <TableCell>
        {/* Always two lines, even with no page, so every row is one height. */}
        <TableCellLines
          title
          primary={target}
          secondary={signalPageLine(signal) ?? ' '}
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
      <TableActionsCell>
        <Button
          variant="ghost"
          aria-label={`Inspect evidence for ${target}`}
          onClick={() => onInspect(signal)}
        >
          Inspect
        </Button>
        {/* A signal promoted into an Action opens it; any other is asked about. */}
        {signal.action_id ? (
          <Button variant="secondary" asChild>
            <ProjectLink
              href={`/agent/actions/${signal.action_id}`}
              aria-label={`Open the Action for ${target}`}
            >
              Open Action
              <Icon icon={ChevronRight} />
            </ProjectLink>
          </Button>
        ) : (
          <Button variant="ghost" asChild>
            <ProjectLink
              href={demandSignalHandoffHref(signal)}
              aria-label={`Ask agent about ${target}`}
            >
              Ask agent
              <Icon icon={ChevronRight} />
            </ProjectLink>
          </Button>
        )}
      </TableActionsCell>
    </TableRow>
  );
}

function Count({ value }: Readonly<{ value: number | null }>) {
  return value === null ? <UnavailableValue state="not_measured" /> : formatCount(value);
}

function Position({ value }: Readonly<{ value: number | null }>) {
  return value === null ? <UnavailableValue state="not_measured" /> : value.toFixed(1);
}

/** The persisted CTR, else clicks over impressions; never a guessed zero. */
function Ctr({ signal }: Readonly<{ signal: DemandSignal }>) {
  const persisted = numericMetric(signal, 'ctr');
  if (persisted !== null) return `${(persisted * 100).toFixed(1)}%`;
  const impressions = numericMetric(signal, 'impressions');
  const clicks = numericMetric(signal, 'clicks');
  if (impressions === null || clicks === null || impressions === 0)
    return <UnavailableValue state="not_measured" />;
  return `${((clicks / impressions) * 100).toFixed(1)}%`;
}
