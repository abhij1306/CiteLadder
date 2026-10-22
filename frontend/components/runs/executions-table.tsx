'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import { Inline, Stack } from '@/components/ui/layout';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { engineLabel, productTransportLabel } from '@/lib/providers/catalog';
import type { Execution } from '@/lib/api/types';
import {
  executionBadgeValue,
  executionFailureReason,
  executionStatusLabel,
} from '@/lib/runs/status';
import { textRole } from '@/components/ui/typography';

const COLUMNS: readonly DataTableColumn[] = [
  { key: 'prompt', label: 'Prompt' },
  { key: 'engine', label: 'Engine', width: 'status' },
  { key: 'status', label: 'Status', width: 'name' },
  { key: 'latency', label: 'Latency', width: 'figure', numeric: true },
  { key: 'evidence', label: 'Evidence', width: 'action', hideLabel: true },
];

/**
 * Executions table for a run, on the shared `DataTable`.
 *
 * One row per execution/queue task: the prompt, the
 * engine badge (logical + transport), status badge, and latency (mono).
 * Succeeded rows open the evidence drawer without leaving the run. The read's
 * loading, error and empty states render inside the table under its header.
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
  return (
    <DataTable title="Executions" columns={COLUMNS} state={state}>
      {executions.map((execution) => (
        <TableRow key={execution.id}>
          <TableCell>
            <ClampText>
              {execution.prompt_text || `Prompt #${execution.prompt_index + 1}`}
            </ClampText>
          </TableCell>
          <TableCell>
            <ClampText>
              <Inline as="span" className="inline-flex">
                <span className={textRole('itemTitle')}>
                  {engineLabel(execution.logical_engine)}
                </span>
                {productTransportLabel(execution.transport_provider) ? (
                  <span className="type-caption">
                    {productTransportLabel(execution.transport_provider)}
                  </span>
                ) : null}
              </Inline>
            </ClampText>
          </TableCell>
          <TableCell>
            <Stack gap="tight" className="justify-items-start">
              <Badge variant="status" value={executionBadgeValue(execution.status)}>
                {executionStatusLabel(execution.status, engineLabel(execution.logical_engine))}
              </Badge>
              {execution.status === 'failed' ? (
                <ClampText lines={1} className="type-caption">
                  {executionFailureReason(execution.error_code)}
                </ClampText>
              ) : null}
            </Stack>
          </TableCell>
          <TableCell numeric>
            {execution.latency_ms == null ? (
              <UnavailableValue state="not_measured" />
            ) : (
              `${execution.latency_ms} ms`
            )}
          </TableCell>
          <TableCell className="text-right">
            {execution.status === 'succeeded' ? (
              <Button variant="ghost" onClick={() => onSelectEvidence(execution)}>
                Evidence
              </Button>
            ) : (
              <UnavailableValue state="unavailable" />
            )}
          </TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}
