'use client';

import { Bot } from 'lucide-react';

import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import type { Visibility } from '@/lib/api/types';
import {
  engineLabel,
  formatRate,
  measured,
  visibleEngines,
  type VisibilityFilters,
} from '@/lib/visibility/dashboard';
import { MissingValue } from '@/components/ui/unavailable-value';
import { textRole } from '@/components/ui/typography';

const COLUMNS: readonly DataTableColumn[] = [
  { key: 'model', label: 'Model' },
  { key: 'visibility', label: 'Visibility', width: 'figure', numeric: true },
  { key: 'owned', label: 'Owned citation rate', width: 'status', numeric: true },
  { key: 'answers', label: 'Answers', width: 'figure', numeric: true },
];

export function EngineComparison({
  visibility,
  filter,
  onSelect,
}: Readonly<{
  visibility: Visibility;
  filter: VisibilityFilters['engine'];
  onSelect?: (engine: string) => void;
}>) {
  const engines = visibleEngines(visibility, filter);
  return (
    <DataTable
      title="By model"
      columns={COLUMNS}
      footer="How each answer engine treated your brand."
      state={
        engines.length
          ? undefined
          : { kind: 'empty', headingLevel: 3, icon: Bot, heading: 'No model observations' }
      }
    >
      {engines.map((engine) => (
        <TableRow key={engine.logical_engine}>
          <TableCell>
            {onSelect ? (
              <Button variant="ghost" onClick={() => onSelect(engine.logical_engine)}>
                {engineLabel(engine.logical_engine)}
              </Button>
            ) : (
              <ClampText lines={1}>{engineLabel(engine.logical_engine)}</ClampText>
            )}
            <ClampText lines={1} className={textRole('caption', 'text-secondary')}>
              {visibility.model_provenance
                .filter((item) => item.logical_engine === engine.logical_engine)
                .map((item) => item.transport_model)
                .join(', ')}
            </ClampText>
          </TableCell>
          <TableCell numeric>
            {measured(formatRate(engine.brand_mention_rate)) ?? <MissingValue />}
          </TableCell>
          <TableCell numeric>
            {measured(formatRate(engine.owned_citation_rate)) ?? <MissingValue />}
          </TableCell>
          {/* This read "N measured / M expected", or "expected count
              unavailable" — the run's own bookkeeping. How many answers
              a rate is drawn from is the reader's business; how many we
              hoped for is not. */}
          <TableCell numeric>{engine.total_completed}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}
