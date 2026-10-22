'use client';

import { Download } from 'lucide-react';
import { useMemo } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CsvImportFileInput, CsvImportPreview, useCsvImportFile } from '@/components/ui/csv-import';
import { Dialog } from '@/components/ui/dialog';
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
import type { PromptImportRow } from '@/lib/api/prompts';
import { downloadCsv } from '@/lib/csv/download';
import {
  PROMPT_CSV_COLUMNS,
  PROMPT_CSV_SAMPLE_ROWS,
  parsePromptCsv,
  validRows,
  type ParsedCsv,
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
    return <ClampText className="type-caption text-danger-text">{errors.join(' ')}</ClampText>;
  return <span className="type-caption text-success-text">Ready</span>;
}

function downloadSample() {
  downloadCsv('prompts-sample.csv', PROMPT_CSV_COLUMNS, PROMPT_CSV_SAMPLE_ROWS);
}

export function CsvImportDialog({
  open,
  onOpenChange,
  onImport,
  isImporting,
  error,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (rows: PromptImportRow[]) => Promise<void> | void;
  isImporting?: boolean;
  error?: string;
}>) {
  const { fileName, inputRef, parsed, reset, selectFile } =
    useCsvImportFile<ParsedCsv>(parsePromptCsv);

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
      className="w-205"
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
      <div className="grid gap-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-60 flex-1">
            <CsvImportFileInput inputRef={inputRef} onSelect={(file) => void selectFile(file)} />
          </div>
          <Button variant="secondary" onClick={downloadSample}>
            <Download className="size-4" aria-hidden />
            Download sample CSV
          </Button>
        </div>

        {parsed && parsed.errors.length > 0 ? (
          <Alert tone="danger">{parsed.errors.join(' ')}</Alert>
        ) : null}

        {parsed && parsed.rows.length > 0 ? (
          <CsvImportPreview
            errorCount={errorCount}
            fileName={fileName}
            rowCount={parsed.rows.length}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead numeric>Row</TableHead>
                  <TableHead>Topic</TableHead>
                  <TableHead>Prompt</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsed.rows.map((row) => {
                  const invalid = row.errors.length > 0;
                  return (
                    <TableRow key={row.line} className={invalid ? 'opacity-60' : undefined}>
                      <TableCell numeric className="text-muted">
                        {row.line}
                      </TableCell>
                      <TableCell className="max-w-45">
                        {row.input.topic || <UnavailableValue state="not_set" />}
                      </TableCell>
                      <TableCell className="max-w-90">
                        {row.input.text || <UnavailableValue state="not_set" />}
                      </TableCell>
                      <TableCell>
                        <RowStatus errors={row.errors} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CsvImportPreview>
        ) : null}
      </div>
    </Dialog>
  );
}
