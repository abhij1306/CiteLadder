import type { BrandFactImportResult } from '@citeladder/contracts/fact-checking';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { Absence } from '@/components/ui/absence';
import { Button } from '@/components/ui/button';
import { CsvImportFileInput, CsvImportPreview, useCsvImportFile } from '@/components/ui/csv-import';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Stack } from '@/components/ui/layout';
import { Notice } from '@/components/ui/notice';
import { StatusMark } from '@/components/ui/status-mark';
import { TableCell, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { Download } from '@/lib/icons';
import { humanizeApiError } from '@/lib/api/errors';
import { projectMutations } from '@/lib/api/projects';
import { downloadCsv } from '@/lib/csv/download';
import { useProjectScope } from '@/lib/project/active-project-scope';
import {
  FACT_CSV_COLUMNS,
  FACT_CSV_SAMPLE_ROWS,
  parseFactCsv,
  type ParsedFactCsv,
  type ParsedFactRow,
} from '@/lib/project/facts-csv';
import { useBrandFacts } from '@/lib/project/use-brand-facts';
import { pluralCount } from '@/lib/format';

type Outcome = BrandFactImportResult['rows'][number];

const PREVIEW_COLUMNS: readonly DataTableColumn[] = [
  { key: 'line', label: 'Row', width: 'index', kind: 'number' },
  { key: 'topic', label: 'Topic', width: 'figure' },
  { key: 'statement', label: 'Statement' },
  { key: 'status', label: 'Status', width: 'category' },
];

export function FactsImportDialog({
  open,
  onOpenChange,
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void }>) {
  const { notify } = useToast();
  const importing = useMutation(projectMutations.importBrandFacts(useProjectScope()));
  const [outcomes, setOutcomes] = useState<Map<number, Outcome> | null>(null);
  const maxRows = useBrandFacts().data?.limits.facts_import_max_rows ?? null;
  const { fileName, inputRef, parsed, readError, reading, reset, selectFile } =
    useCsvImportFile<ParsedFactCsv>((raw) => parseFactCsv(raw, maxRows));
  const ready = parsed?.rows.filter((row) => row.errors.length === 0) ?? [];

  const close = (next: boolean) => {
    if (!next) {
      reset();
      setOutcomes(null);
      importing.reset();
    }
    onOpenChange(next);
  };
  const confirm = () =>
    importing.mutate(
      { rows: ready.map((row) => row.input) },
      {
        onSuccess: (result) => {
          setOutcomes(new Map(result.rows.map((row) => [ready[row.index]!.line, row])));
          const created = result.rows.filter((row) => row.kind === 'created').length;
          notify('Facts imported', `${pluralCount(created, 'draft fact')} added.`);
        },
      },
    );

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Import facts from CSV"
      description="Columns: topic, statement, source_url. Facts import as drafts; runs check against them once you confirm them."
      width="wide"
      footer={
        outcomes ? (
          <Button variant="primary" onClick={() => close(false)}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              pending={importing.isPending}
              disabled={reading || ready.length === 0 || Boolean(parsed?.errors.length)}
              onClick={confirm}
            >
              Import {pluralCount(ready.length, 'fact')}
            </Button>
          </>
        )
      }
    >
      <Stack gap="workspace">
        {importing.isError ? (
          <Notice tone="negative">{humanizeApiError(importing.error).message}</Notice>
        ) : null}
        {outcomes ? null : (
          <Stack gap="compact">
            <CsvImportFileInput inputRef={inputRef} onSelect={(file) => void selectFile(file)} />
            <Button
              variant="secondary"
              className="justify-self-start"
              onClick={() =>
                downloadCsv('facts-sample.csv', FACT_CSV_COLUMNS, FACT_CSV_SAMPLE_ROWS)
              }
            >
              <Icon icon={Download} />
              Download sample CSV
            </Button>
          </Stack>
        )}
        {readError ? <Notice tone="negative">{readError}</Notice> : null}
        {parsed?.errors.length ? <Notice tone="negative">{parsed.errors.join(' ')}</Notice> : null}
        {parsed?.rows.length ? (
          <CsvImportPreview
            errorCount={parsed.rows.length - ready.length}
            fileName={fileName}
            rowCount={parsed.rows.length}
          >
            <DataTable label="Parsed facts" columns={PREVIEW_COLUMNS}>
              {parsed.rows.map((row) => (
                <TableRow key={row.line} className={row.errors.length ? 'opacity-60' : undefined}>
                  <TableCell numeric className="text-ink-2">
                    {row.line}
                  </TableCell>
                  <TableCell>{row.input.topic || <Absence state="not_set" />}</TableCell>
                  <TableCell>{row.input.statement || <Absence state="not_set" />}</TableCell>
                  <TableCell>
                    <RowStatus row={row} outcome={outcomes?.get(row.line)} />
                  </TableCell>
                </TableRow>
              ))}
            </DataTable>
          </CsvImportPreview>
        ) : null}
      </Stack>
    </Dialog>
  );
}

function RowStatus({ row, outcome }: Readonly<{ row: ParsedFactRow; outcome?: Outcome }>) {
  if (row.errors.length) return <StatusMark tone="negative">{row.errors.join(' ')}</StatusMark>;
  if (!outcome) return <StatusMark tone="positive">Ready</StatusMark>;
  switch (outcome.kind) {
    case 'created':
      return <StatusMark tone="positive">Added as draft</StatusMark>;
    case 'duplicate':
      return <StatusMark tone="neutral">Already a fact</StatusMark>;
    case 'invalid':
      return <StatusMark tone="negative">{outcome.message}</StatusMark>;
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}
