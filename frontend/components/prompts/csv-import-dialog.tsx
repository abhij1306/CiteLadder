'use client';

import { Download } from 'lucide-react';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { MutationNotice } from '@/components/ui/mutation-notice';
import type { MutationNotice as MutationNoticeData } from '@/lib/api/mutation-notice';
import { CsvImportFileInput, CsvImportPreview, useCsvImportFile } from '@/components/ui/csv-import';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Stack } from '@/components/ui/layout';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import type { PromptImportRowRequest } from '@citeladder/contracts/prompt-requests';
import { downloadCsv } from '@/lib/csv/download';
import {
  PROMPT_CSV_COLUMNS,
  PROMPT_CSV_SAMPLE_ROWS,
  parsePromptCsv,
  validRows,
  type ParsedCsv,
  type PromptCsvLimits,
} from '@/lib/prompts/csv';

/**
 * CSV import dialog. The file is parsed + validated in the browser and the
 * parsed rows are previewed (with per-row errors) BEFORE anything is persisted.
 * On confirm, only the importable rows are handed to `onImport`, which posts
 * them to the `/prompt-sets/{id}/import` endpoint. The sample file is built
 * from the same column contract the parser reads.
 */
function RowStatus({ errors }: Readonly<{ errors: readonly string[] }>) {
  if (errors.length > 0)
    return <ClampText className="type-caption text-negative">{errors.join(' ')}</ClampText>;
  return <span className="type-caption text-positive">Ready</span>;
}

const PREVIEW_COLUMNS: readonly DataTableColumn[] = [
  { key: 'line', label: 'Row', width: 'index', numeric: true },
  { key: 'topic', label: 'Topic', width: 'name' },
  { key: 'prompt', label: 'Prompt' },
  { key: 'status', label: 'Status', width: 'status' },
];

function downloadSample() {
  downloadCsv('prompts-sample.csv', PROMPT_CSV_COLUMNS, PROMPT_CSV_SAMPLE_ROWS);
}

export function CsvImportDialog({
  open,
  onOpenChange,
  onImport,
  isImporting,
  error,
  limits,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (rows: PromptImportRowRequest[]) => Promise<void> | void;
  isImporting?: boolean;
  error?: MutationNoticeData;
  /** The import bounds the API enforces, from the prompt-set list. */
  limits: PromptCsvLimits;
}>) {
  const { fileName, inputRef, parsed, reset, selectFile } = useCsvImportFile<ParsedCsv>((raw) =>
    parsePromptCsv(raw, limits),
  );

  const importable = useMemo(() => (parsed ? validRows(parsed) : []), [parsed]);
  const importNoun = importable.length === 1 ? 'prompt' : 'prompts';
  const errorCount = parsed ? parsed.rows.filter((row) => row.errors.length > 0).length : 0;

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const confirm = async () => {
    if (importable.length === 0) return;
    await onImport(importable);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Import prompts from CSV"
      description="Columns: topic, prompt. New topic names are created; rows without a topic import without one."
      width="wide"
      footer={
        <>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={confirm}
            disabled={isImporting || importable.length === 0 || Boolean(parsed?.errors.length)}
          >
            {isImporting ? 'Importing…' : `Import ${importable.length} ${importNoun}`}
          </Button>
        </>
      }
    >
      <Stack gap="workspace">
        {error ? <MutationNotice notice={error} /> : null}

        <Stack gap="compact">
          <CsvImportFileInput inputRef={inputRef} onSelect={(file) => void selectFile(file)} />
          <Button variant="secondary" className="justify-self-start" onClick={downloadSample}>
            <Icon icon={Download} />
            Download sample CSV
          </Button>
        </Stack>

        {parsed && parsed.errors.length > 0 ? (
          <Callout tone="negative">{parsed.errors.join(' ')}</Callout>
        ) : null}

        {parsed && parsed.rows.length > 0 ? (
          <CsvImportPreview
            errorCount={errorCount}
            fileName={fileName}
            rowCount={parsed.rows.length}
          >
            <DataTable nested label="Parsed rows" columns={PREVIEW_COLUMNS}>
              {parsed.rows.map((row) => {
                const invalid = row.errors.length > 0;
                return (
                  <TableRow key={row.line} className={invalid ? 'opacity-60' : undefined}>
                    <TableCell numeric className="text-ink-muted">
                      {row.line}
                    </TableCell>
                    <TableCell>{row.input.topic || <UnavailableValue state="not_set" />}</TableCell>
                    <TableCell>{row.input.text || <UnavailableValue state="not_set" />}</TableCell>
                    <TableCell>
                      <RowStatus errors={row.errors} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </DataTable>
          </CsvImportPreview>
        ) : null}
      </Stack>
    </Dialog>
  );
}
