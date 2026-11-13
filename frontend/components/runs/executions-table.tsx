import { useState } from 'react';

import { useExecutionFilters } from '@/components/runs/executions-filters';
import { Badge } from '@/components/ui/badge';
import { pageNumberControls, useTablePage } from '@/components/ui/pager';
import { TABLE_DEFAULT_PAGE_SIZE, isTablePageSize, type TablePageSize } from '@/lib/config/tables';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import { Stack } from '@/components/ui/layout';
import {
  ClampText,
  TableActionsCell,
  TableCell,
  TableCellLines,
  TableRow,
} from '@/components/ui/table';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { formatCount } from '@/lib/format';
import { ICONS } from '@/lib/icons';
import { productTransportLabel } from '@/lib/providers/catalog';
import { useEngineCatalog } from '@/lib/providers/engines';
import type { Execution } from '@citeladder/contracts';
import { EXECUTION_STATES, executionFailureReason, executionStatusLabel } from '@/lib/runs/status';

const COLUMNS: readonly DataTableColumn[] = [
  { key: 'prompt', label: 'Prompt' },
  // Wide enough for the longest engine on one line ("Google AI Overview").
  { key: 'engine', label: 'Engine', width: 'category' },
  // A long waiting state ("Waiting for Google AI Overview") cuts with a title.
  { key: 'status', label: 'Status', width: 'category' },
  { key: 'latency', label: 'Latency', width: 'figure', numeric: true },
  { key: 'evidence', label: 'Evidence', width: 'action', trailing: true, hideLabel: true },
];

/**
 * Executions table for a run, on the shared `DataTable`.
 *
 * One row per execution/queue task: the prompt, the
 * engine badge (logical + transport), status badge, and latency (mono).
 * Succeeded rows open the evidence drawer without leaving the run. The read's
 * loading, error and empty states render inside the table under its header.
 * The list arrives whole, so the Engine and Status filters and the pages are
 * cut here.
 */
export function ExecutionsTable({
  executions,
  state,
  onSelectEvidence,
}: Readonly<{
  executions: readonly Execution[];
  /** What the table shows instead of rows while the read is not ready. */
  state?: DataTableState;
  onSelectEvidence: (execution: Execution) => void;
}>) {
  const engines = useEngineCatalog();
  const filters = useExecutionFilters(executions);
  const [pageSize, setPageSize] = useState<TablePageSize>(TABLE_DEFAULT_PAGE_SIZE);
  const { page, setPage, pageCount, from, to } = useTablePage(filters.rows.length, pageSize);
  const [pagedFilter, setPagedFilter] = useState(filters.key);
  if (pagedFilter !== filters.key) {
    setPagedFilter(filters.key);
    setPage(1);
  }
  const pageRows = filters.rows.slice(from - 1, to);
  const unmatched: DataTableState | undefined =
    executions.length > 0 && filters.rows.length === 0
      ? {
          kind: 'empty',
          headingLevel: 3,
          icon: ICONS.runs,
          heading: 'No executions match your filters',
        }
      : undefined;
  return (
    <DataTable
      title="Executions"
      // The filters need rows to choose from: none while the read stands in.
      toolbar={state ? undefined : { filters: filters.definitions }}
      columns={COLUMNS}
      state={state ?? unmatched}
      rowLines={2}
      rowCount={pageRows.length}
      pageSize={pageCount > 1 ? pageSize : undefined}
      pager={{
        range: { from, to, total: filters.rows.length, noun: 'executions' },
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
      {pageRows.map((execution) => (
        <TableRow key={execution.id}>
          <TableCell>
            <ClampText>
              {execution.prompt_text || `Prompt #${execution.prompt_index + 1}`}
            </ClampText>
          </TableCell>
          <TableCell>
            {/* The engine over the transport that reached it, each on its own line. */}
            <TableCellLines
              title
              primary={engines.label(execution.logical_engine)}
              secondary={productTransportLabel(execution.transport_provider)}
            />
          </TableCell>
          <TableCell>
            <Stack gap="tight" className="justify-items-start">
              <StatusBadge execution={execution} />
              {execution.status === 'failed' ? (
                <ClampText lines={1} className="type-caption max-w-full">
                  {executionFailureReason(execution.error_code)}
                </ClampText>
              ) : null}
            </Stack>
          </TableCell>
          <TableCell numeric>
            {execution.latency_ms == null ? (
              <UnavailableValue state="not_measured" />
            ) : (
              `${formatCount(execution.latency_ms)} ms`
            )}
          </TableCell>
          <TableActionsCell>
            {/* A real button face, so the control reads as one, not as loose text. */}
            {execution.status === 'succeeded' ? (
              <Button variant="secondary" onClick={() => onSelectEvidence(execution)}>
                Evidence
              </Button>
            ) : (
              <UnavailableValue state="unavailable" />
            )}
          </TableActionsCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

/** The execution's state; a label longer than the column is cut, whole in its title. */
function StatusBadge({ execution }: Readonly<{ execution: Execution }>) {
  const engines = useEngineCatalog();
  const label = executionStatusLabel(execution.status, engines.label(execution.logical_engine));
  return (
    <Badge
      variant="status"
      value={EXECUTION_STATES[execution.status].badge}
      className="max-w-full"
      title={label}
    >
      <span className="min-w-0 truncate">{label}</span>
    </Badge>
  );
}
