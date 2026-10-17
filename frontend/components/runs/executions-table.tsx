'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ClampText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { engineLabel, productTransportLabel } from '@/lib/providers/catalog';
import type { Execution } from '@/lib/api/types';
import {
  executionBadgeValue,
  executionFailureReason,
  executionStatusLabel,
} from '@/lib/runs/status';
import { textRole } from '@/components/ui/typography';

/**
 * Executions table for a run.
 *
 * One row per execution/queue task: the prompt, the
 * engine badge (logical + transport), status badge, and latency (mono).
 * Succeeded rows open the evidence drawer without leaving the run.
 */
export function ExecutionsTable({
  executions,
  onSelectEvidence,
}: Readonly<{ executions: Execution[]; onSelectEvidence: (execution: Execution) => void }>) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Prompt</TableHead>
          <TableHead>Engine</TableHead>
          <TableHead>Status</TableHead>
          <TableHead numeric>Latency</TableHead>
          <TableHead className="sr-only">Evidence</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {executions.map((execution) => (
          <TableRow key={execution.id}>
            <TableCell className="max-w-2xl">
              <ClampText>
                {execution.prompt_text || `Prompt #${execution.prompt_index + 1}`}
              </ClampText>
            </TableCell>
            <TableCell>
              <ClampText>
                <span className={textRole('itemTitle')}>
                  {engineLabel(execution.logical_engine)}
                </span>
                {productTransportLabel(execution.transport_provider) ? (
                  <span className="type-caption ml-2">
                    {productTransportLabel(execution.transport_provider)}
                  </span>
                ) : null}
              </ClampText>
            </TableCell>
            <TableCell>
              <div className="flex flex-col items-start gap-1">
                <Badge variant="status" value={executionBadgeValue(execution.status)}>
                  {executionStatusLabel(execution.status, engineLabel(execution.logical_engine))}
                </Badge>
                {execution.status === 'failed' ? (
                  <ClampText lines={1} className="type-caption max-w-xs">
                    {executionFailureReason(execution.error_code)}
                  </ClampText>
                ) : null}
              </div>
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
                <Button variant="ghost" size="sm" onClick={() => onSelectEvidence(execution)}>
                  Evidence
                </Button>
              ) : (
                <UnavailableValue state="unavailable" />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
