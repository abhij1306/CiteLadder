import { useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Download, X } from '@/lib/icons';
import type { MutationNotice as MutationNoticeData } from '@/lib/api/mutation-notice';
import { CsvImportFileInput, CsvImportPreview, useCsvImportFile } from '@/components/ui/csv-import';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Stack } from '@/components/ui/layout';
import { StatusMark } from '@/components/ui/status-mark';
import { TableCell, TableRow } from '@/components/ui/table';
import { Absence } from '@/components/ui/absence';
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
import { Notice } from '@/components/ui/notice';

/**
 * CSV import dialog. The file is parsed + validated in the browser and the
 * parsed rows are previewed (with per-row errors) BEFORE anything is persisted.
 * On confirm, only the importable rows are handed to `onImport`, which posts
 * them to the `/prompt-sets/{id}/import` endpoint. The sample file is built
 * from the same column contract the parser reads.
 */
function RowStatus({ errors }: Readonly<{ errors: readonly string[] }>) {
  if (errors.length > 0) return <StatusMark tone="negative">{errors.join(' ')}</StatusMark>;
  return <StatusMark tone="positive">Ready</StatusMark>;
}

const PREVIEW_COLUMNS: readonly DataTableColumn[] = [
  { key: 'line', label: 'Row', width: 'index', kind: 'number' },
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
  limits: PromptCsvLimits;
}>) {
  const { fileName, inputRef, parsed, readError, reading, reset, selectFile } =
    useCsvImportFile<ParsedCsv>((raw) => parsePromptCsv(raw, limits));

  const importable = useMemo(() => (parsed ? validRows(parsed) : []), [parsed]);
  const importNoun = importable.length === 1 ? 'prompt' : 'prompts';

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submitting = useRef(false);
  const [submitted, setSubmitted] = useState(false);
  const confirm = async () => {
    if (importable.length === 0 || submitting.current) return;
    submitting.current = true;
    setSubmitted(true);
    try {
      await onImport(importable);
    } finally {
      submitting.current = false;
      setSubmitted(false);
    }
  };
  const importing = Boolean(isImporting) || submitted;

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Import prompts from CSV"
      description="Columns: topic, prompt."
      width="wide"
      footer={
        <>
          <Button variant="quiet" onClick={() => handleOpenChange(false)}>
            <Icon icon={X} />
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={confirm}
            disabled={
              importing || reading || importable.length === 0 || Boolean(parsed?.errors.length)
            }
          >
            {importing ? 'Importing…' : `Import ${importable.length} ${importNoun}`}
          </Button>
        </>
      }
    >
      <Stack gap="workspace">
        {error ? <Notice kind="mutation" notice={error} /> : null}

        <Stack gap="compact">
          <CsvImportFileInput inputRef={inputRef} onSelect={(file) => void selectFile(file)} />
          <Button variant="secondary" className="justify-self-start" onClick={downloadSample}>
            <Icon icon={Download} />
            Download sample CSV
          </Button>
        </Stack>

        {readError ? <Notice tone="negative">{readError}</Notice> : null}

        {parsed && parsed.errors.length > 0 ? (
          <Notice tone="negative">{parsed.errors.join(' ')}</Notice>
        ) : null}

        {parsed ? <ParsedRows parsed={parsed} fileName={fileName} /> : null}
      </Stack>
    </Dialog>
  );
}

function ParsedRows({
  parsed,
  fileName,
}: Readonly<{ parsed: ParsedCsv; fileName: string | null }>) {
  if (parsed.rows.length === 0) return null;
  const errorCount = parsed.rows.filter((row) => row.errors.length > 0).length;
  return (
    <CsvImportPreview errorCount={errorCount} fileName={fileName} rowCount={parsed.rows.length}>
      <DataTable label="Parsed rows" columns={PREVIEW_COLUMNS}>
        {parsed.rows.map((row) => {
          const invalid = row.errors.length > 0;
          return (
            <TableRow key={row.line} className={invalid ? 'opacity-60' : undefined}>
              <TableCell numeric className="text-ink-2">
                {row.line}
              </TableCell>
              <TableCell>{row.input.topic || <Absence state="not_set" />}</TableCell>
              <TableCell>{row.input.text || <Absence state="not_set" />}</TableCell>
              <TableCell>
                <RowStatus errors={row.errors} />
              </TableCell>
            </TableRow>
          );
        })}
      </DataTable>
    </CsvImportPreview>
  );
}
