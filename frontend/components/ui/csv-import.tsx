import { useRef, useState, type ReactNode, type RefObject } from 'react';

import { StatusMark } from '@/components/ui/status-mark';
import { READ_FAILED_MESSAGE, readCsvFileText } from '@/lib/csv/read-file-text';

export function useCsvImportFile<T>(parse: (text: string) => T) {
  const [parsed, setParsed] = useState<T | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selection = useRef(0);

  const reset = () => {
    selection.current += 1;
    setParsed(null);
    setFileName(null);
    setReadError(null);
    setReading(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const selectFile = async (file: File | undefined) => {
    if (!file) return;
    const current = ++selection.current;
    setFileName(file.name);
    setParsed(null);
    setReadError(null);
    setReading(true);
    let text: string;
    try {
      text = await readCsvFileText(file);
    } catch (cause) {
      if (current !== selection.current) return;
      setReadError(cause instanceof Error ? cause.message : READ_FAILED_MESSAGE);
      setReading(false);
      return;
    }
    if (current !== selection.current) return;
    setParsed(parse(text));
    setReading(false);
  };

  return { fileName, inputRef, parsed, readError, reading, reset, selectFile };
}

export function CsvImportFileInput({
  inputRef,
  onSelect,
  label = 'CSV file',
  accept = '.csv,text/csv',
}: Readonly<{
  inputRef?: RefObject<HTMLInputElement | null>;
  onSelect: (file: File | undefined) => void;
  label?: string;
  accept?: string;
}>) {
  return (
    <label className="grid gap-2">
      <span className="type-body text-ink-2">{label}</span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        aria-label={label}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          onSelect(file);
          event.currentTarget.value = '';
        }}
        className="focus-ring border-rule bg-surface text-ink file:bg-well file:text-ink type-body type-control-file rounded-control file:rounded-control block w-full border px-2 py-2 file:me-2 file:border-0 file:px-2 file:py-1"
      />
    </label>
  );
}

export function CsvImportPreview({
  children,
  errorCount,
  fileName,
  rowCount,
}: Readonly<{
  children: ReactNode;
  errorCount: number;
  fileName: string | null;
  rowCount: number;
}>) {
  return (
    <div className="grid gap-2">
      <div className="type-body text-ink-2 flex items-center gap-3">
        <span>
          Parsed <span className="text-ink">{rowCount}</span> row
          {rowCount === 1 ? '' : 's'}
          {fileName ? ` from ${fileName}` : ''}.
        </span>
        {errorCount > 0 ? (
          <StatusMark variant="status" value="danger">
            {errorCount} skipped
          </StatusMark>
        ) : null}
      </div>
      <div className="rounded-control max-h-85 overflow-auto">{children}</div>
    </div>
  );
}
