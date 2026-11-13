import { useState, type MouseEvent } from 'react';
import { ChevronRight, MoreHorizontal, Search } from 'lucide-react';

import { ProjectLink } from '@/components/ui/project-link';
import { Badge } from '@/components/ui/badge';
import { IconButton } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Icon } from '@/components/ui/icon';
import { InfoHint } from '@/components/ui/info-hint';
import { Menu, MenuContent, MenuItem, MenuLinkItem, MenuTrigger } from '@/components/ui/menu';
import { pageNumberControls, useTablePage } from '@/components/ui/pager';
import { TableActionsCell, TableCell, TableCellLines, TableRow } from '@/components/ui/table';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import type { DemandDetectorPolicy } from '@citeladder/contracts';
import type { DemandSignal } from '@/lib/api/demand';
import { TABLE_DEFAULT_PAGE_SIZE, isTablePageSize, type TablePageSize } from '@/lib/config/tables';
import {
  demandSignalHandoffHref,
  numericMetric,
  signalPage,
  signalSubject,
  signalDefinition,
  signalTarget,
  signalTypeMeta,
  type RankedSignal,
} from '@/lib/demand/signals';
import { formatCount } from '@/lib/format';

/**
 * The row itself is the Inspect target, so the query keeps the width a
 * column of row buttons used to take: its two remaining actions share one
 * overflow menu in the narrow action column.
 */
const COLUMNS: readonly DataTableColumn[] = [
  // The index role fits '#', not a word; the figure role fits 'Position' on
  // one line where 'Avg. position' wrapped the header row to two.
  { key: 'rank', label: '#', width: 'index', numeric: true },
  { key: 'target', label: 'Query or page' },
  { key: 'signal', label: 'Signal', width: 'category' },
  { key: 'impressions', label: 'Impressions', width: 'figure', numeric: true },
  { key: 'clicks', label: 'Clicks', width: 'figure', numeric: true },
  { key: 'ctr', label: 'CTR', width: 'figure', numeric: true },
  { key: 'position', label: 'Position', width: 'figure', numeric: true },
  { key: 'actions', label: 'Actions', width: 'action', hideLabel: true, trailing: true },
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

/**
 * Each signal type in the snapshot, explained once, behind one
 * hint on the summary line so it is read before the table. It lists the
 * whole snapshot's types rather than the filtered ones, so choosing a filter
 * never changes it.
 */
export function SignalLegend({
  signals,
  policy,
}: Readonly<{ signals: readonly DemandSignal[]; policy: DemandDetectorPolicy }>) {
  const types = [...new Set(signals.map((signal) => signal.signal_type))];
  if (types.length === 0) return null;
  // One line per type: joined into a sentence, each definition ran into the
  // next type's label.
  return (
    <InfoHint label="Signal types">
      {types.map((type) => {
        const meta = signalTypeMeta(type);
        return (
          <span key={type} className="block">
            {`${meta.label}: ${signalDefinition(type, policy)} `}
          </span>
        );
      })}
    </InfoHint>
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
      minWidth="md"
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
  const subject = signalSubject(signal);
  const inspect = () => onInspect(signal);
  // A press that selected text, or landed on a control inside the row, is not
  // a request to inspect.
  const inspectFromRow = (event: MouseEvent<HTMLTableRowElement>) => {
    if (!window.getSelection()?.isCollapsed) return;
    const control = event.target instanceof Element ? event.target.closest(ROW_CONTROLS) : null;
    if (control && control !== event.currentTarget) return;
    inspect();
  };
  return (
    // The row is the Inspect target: pressed, or Enter/Space while focused.
    // Native row and cell semantics stay; the menu names Inspect too, so the
    // action is announced by name as well.
    <TableRow
      tabIndex={0}
      onClick={inspectFromRow}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        inspect();
      }}
      className="focus-ring cursor-pointer"
    >
      <TableCell numeric>{rank}</TableCell>
      <TableCell>
        {/* Always two lines, so every row is one height, and the second
            always says whether the row is about a query or a page. */}
        <TableCellLines
          title
          primary={subject.primary}
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
      <TableActionsCell>
        <SignalActions signal={signal} onInspect={inspect} />
      </TableActionsCell>
    </TableRow>
  );
}

/** The controls a row can hold; a press on one is that control's alone. */
const ROW_CONTROLS = 'a, button, input, select, textarea, [role="menuitem"]';

/** A press inside the menu is the menu's, never the row's Inspect. */
const keepFromRow = (event: MouseEvent) => event.stopPropagation();

/**
 * The row's actions in one overflow menu: Inspect, then the hand-off — a
 * signal promoted into an Action opens it, any other is asked about.
 */
function SignalActions({
  signal,
  onInspect,
}: Readonly<{ signal: DemandSignal; onInspect: () => void }>) {
  const target = signalTarget(signal);
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton icon={MoreHorizontal} label={`Actions for ${target}`} onClick={keepFromRow} />
      </MenuTrigger>
      <MenuContent align="end" onClick={keepFromRow}>
        <MenuItem icon={<Icon icon={Search} />} onSelect={onInspect}>
          Inspect evidence
        </MenuItem>
        {signal.action_id ? (
          <MenuLinkItem>
            <ProjectLink
              href={`/agent/actions/${signal.action_id}`}
              aria-label={`Open the Action for ${target}`}
            >
              <Icon icon={ChevronRight} />
              Open Action
            </ProjectLink>
          </MenuLinkItem>
        ) : (
          <MenuLinkItem>
            <ProjectLink
              href={demandSignalHandoffHref(signal)}
              aria-label={`Ask agent about ${target}`}
            >
              <Icon icon={ChevronRight} />
              Ask agent
            </ProjectLink>
          </MenuLinkItem>
        )}
      </MenuContent>
    </Menu>
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
