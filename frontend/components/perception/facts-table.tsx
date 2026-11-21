import type { AccuracyFact, AccuracyFactList } from '@citeladder/contracts/fact-checking';
import type { UseQueryResult } from '@tanstack/react-query';

import { Absence } from '@/components/ui/absence';
import { DataTable } from '@/components/ui/data-table';
import type { DataTableColumn } from '@/components/ui/data-table-columns';
import { TableCell, TableCellLines, TableRow, TableTime } from '@/components/ui/table';
import { VERDICT_LABELS } from '@/lib/visibility/accuracy';

const COLUMNS = [
  { key: 'fact', label: 'Fact, as frozen in the run', kind: 'identity' },
  { key: 'claims', label: 'Claims', width: 'figure', kind: 'number' },
  { key: 'supported', label: VERDICT_LABELS.supported, width: 'figure', kind: 'number' },
  { key: 'contradicted', label: VERDICT_LABELS.contradicted, width: 'figure', kind: 'number' },
  { key: 'inconclusive', label: VERDICT_LABELS.inconclusive, width: 'figure', kind: 'number' },
  { key: 'last', label: 'Last raised', kind: 'date' },
] as const satisfies readonly DataTableColumn[];

export function FactsTable({ query }: Readonly<{ query: UseQueryResult<AccuracyFactList> }>) {
  const facts = query.data?.facts ?? [];
  return (
    <DataTable
      label="Claims by fact"
      columns={COLUMNS}
      rowCount={facts.length}
      state={tableState(query, facts)}
      busy={{ active: query.isFetching && query.isPlaceholderData, label: 'Updating facts' }}
    >
      {facts.map((fact) => (
        <FactRow key={fact.revision_id} fact={fact} />
      ))}
    </DataTable>
  );
}

function tableState(query: UseQueryResult<AccuracyFactList>, facts: readonly AccuracyFact[]) {
  if (query.isPending) return { kind: 'loading', label: 'Loading facts' } as const;
  if (query.isError)
    return {
      kind: 'error',
      error: query.error,
      title: "Couldn't load the facts",
      fallback: 'The facts could not be loaded.',
      onRetry: () => void query.refetch(),
      pending: query.isFetching,
    } as const;
  if (!facts.length)
    return {
      kind: 'empty',
      inline: true,
      message: 'No confirmed facts were frozen in these runs.',
    } as const;
  return undefined;
}

function FactRow({ fact }: Readonly<{ fact: AccuracyFact }>) {
  return (
    <TableRow>
      <TableCell>
        <TableCellLines primary={fact.statement} secondary={`Revision ${fact.revision}`} />
      </TableCell>
      <FactCounts counts={fact.counts} />
    </TableRow>
  );
}

function FactCounts({ counts }: Readonly<{ counts: AccuracyFact['counts'] }>) {
  switch (counts.kind) {
    case 'raised':
      return (
        <>
          <TableCell numeric>{counts.claims}</TableCell>
          <TableCell numeric>{counts.supported}</TableCell>
          <TableCell numeric>{counts.contradicted}</TableCell>
          <TableCell numeric>{counts.inconclusive}</TableCell>
          <TableCell>
            <TableTime value={counts.last_raised_at} />
          </TableCell>
        </>
      );
    case 'not_raised':
    case 'pending':
      return (
        <TableCell colSpan={5}>
          <Absence
            label={
              counts.kind === 'pending' ? 'Claims still being checked' : 'Not raised in any answer'
            }
          />
        </TableCell>
      );
    default: {
      const unreachable: never = counts;
      return unreachable;
    }
  }
}
