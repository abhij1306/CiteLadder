import { useExecutionFilters } from '@/components/runs/executions-filters';
import { StatusMark } from '@/components/ui/status-mark';
import { pageNumberControls, useResizableTablePage } from '@/components/ui/pager';
import { IconButton } from '@/components/ui/button';
import { TitledSection } from '@/components/ui/section';
import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import { Inline } from '@/components/ui/layout';
import { ClampText } from '@/components/ui/clamp-text';
import { TableActionsCell, TableCell, TableCellLines, TableRow } from '@/components/ui/table';
import { Absence } from '@/components/ui/absence';
import { FileSearch, ICONS } from '@/lib/icons';
import { formatCount } from '@/lib/format';
import { useEngineCatalog } from '@/lib/providers/engines';
import type { Execution } from '@citeladder/contracts';
import { EXECUTION_STATES, executionFailureReason, executionStatusLabel } from '@/lib/runs/status';

const COLUMNS: readonly DataTableColumn[] = [
  { key: 'prompt', label: 'Prompt', kind: 'identity' },
  { key: 'engine', label: 'Engine', width: 'category' },
  { key: 'status', label: 'Status', width: 'category' },
  { key: 'latency', label: 'Latency', width: 'figure', kind: 'number' },
  { key: 'evidence', label: 'Evidence', kind: 'actions', hideLabel: true },
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
  state?: DataTableState;
  onSelectEvidence: (execution: Execution) => void;
}>) {
  const engines = useEngineCatalog();
  const filters = useExecutionFilters(executions);
  const { page, setPage, pageCount, from, to, pageSize, pageSizeControl } = useResizableTablePage(
    filters.rows.length,
    { resetKey: filters.key, urlKey: 'page' },
  );
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
    <TitledSection title="Executions">
      <DataTable
        label="Executions"
        toolbar={!state || state.kind === 'loading' ? { filters: filters.definitions } : undefined}
        columns={COLUMNS}
        state={state ?? unmatched}
        rowCount={pageRows.length}
        pageSize={pageCount > 1 ? pageSize : undefined}
        pager={{
          range: { from, to, total: filters.rows.length, noun: 'executions' },
          pageSize: pageSizeControl,
          ...pageNumberControls(page, pageCount, setPage),
        }}
      >
        {pageRows.map((execution) => {
          const prompt = execution.prompt_text || `Prompt #${execution.prompt_index + 1}`;
          return (
            <TableRow key={execution.id}>
              <TableCell>
                <ClampText>{prompt}</ClampText>
              </TableCell>
              <TableCell>
                <TableCellLines title primary={engines.label(execution.logical_engine)} />
              </TableCell>
              <TableCell>
                <Inline as="span">
                  <StatusBadge execution={execution} />
                  {execution.status === 'failed' ? (
                    <ClampText className="text-ink-2">
                      {executionFailureReason(execution.error_code)}
                    </ClampText>
                  ) : null}
                </Inline>
              </TableCell>
              <TableCell numeric>
                {execution.latency_ms == null ? (
                  <Absence state="not_measured" />
                ) : (
                  `${formatCount(execution.latency_ms)} ms`
                )}
              </TableCell>
              <TableActionsCell>
                {execution.status === 'succeeded' ? (
                  <IconButton
                    icon={FileSearch}
                    variant="secondary"
                    onClick={() => onSelectEvidence(execution)}
                    label={`View evidence for ${prompt}, ${engines.label(execution.logical_engine)}`}
                  />
                ) : (
                  <Absence state="unavailable" />
                )}
              </TableActionsCell>
            </TableRow>
          );
        })}
      </DataTable>
    </TitledSection>
  );
}

function StatusBadge({ execution }: Readonly<{ execution: Execution }>) {
  const engines = useEngineCatalog();
  const label = executionStatusLabel(execution.status, engines.label(execution.logical_engine));
  return (
    <StatusMark
      variant="status"
      value={EXECUTION_STATES[execution.status].badge}
      className="max-w-full"
      title={label}
    >
      <span className="min-w-0 truncate">{label}</span>
    </StatusMark>
  );
}
