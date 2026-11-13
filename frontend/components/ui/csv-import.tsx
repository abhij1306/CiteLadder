import { useRef, useState, type ComponentProps, type ReactNode, type RefObject } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { READ_FAILED_MESSAGE, readCsvFileText } from '@/lib/csv/read-file-text';

/** A button-owned hidden picker that permits selecting the same file twice. */
export function CsvImportTrigger({
  label = 'Import CSV',
  pendingLabel = 'Importing…',
  accessibleLabel,
  pending = false,
  onSelect,
  variant = 'secondary',
}: Readonly<{
  label?: ReactNode;
  pendingLabel?: ReactNode;
  accessibleLabel: string;
  pending?: boolean;
  onSelect: (file: File) => void;
  variant?: ComponentProps<typeof Button>['variant'];
}>) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <span className="inline-flex">
      <Button variant={variant} disabled={pending} onClick={() => inputRef.current?.click()}>
        {pending ? pendingLabel : label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        aria-label={accessibleLabel}
        className="sr-only"
        disabled={pending}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) onSelect(file);
        }}
      />
    </span>
  );
}

/**
 * Shared file-selection lifecycle; parsing remains owned by the importing
 * feature. A file that cannot be read, or is not UTF-8, leaves nothing parsed
 * and sets `readError`; only the latest selection lands.
 */
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

/**
 * The consistent file picker (a CSV by default; `label` and `accept` name
 * another kind, such as a product feed); feature-owned parsers receive the
 * selected File.
 */
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
      <span className="type-label">{label}</span>
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
        className="focus-ring border-line bg-surface shadow-edge text-ink file:bg-surface-sunken file:text-ink type-body type-control-file block w-full rounded-md border px-2 py-2 file:me-2 file:rounded-md file:border-0 file:px-2 file:py-1"
      />
    </label>
  );
}

/** Parsed-row summary and scrolling frame around a feature-owned table preview. */
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
      <div className="type-body flex items-center gap-3">
        <span>
          Parsed <span className="text-ink">{rowCount}</span> row
          {rowCount === 1 ? '' : 's'}
          {fileName ? ` from ${fileName}` : ''}.
        </span>
        {errorCount > 0 ? (
          <Badge variant="status" value="danger">
            {errorCount} skipped
          </Badge>
        ) : null}
      </div>
      <div className="border-line max-h-85 overflow-auto rounded-md border">{children}</div>
    </div>
  );
}
