'use client';

import { useRef, useState, type ComponentProps, type ReactNode, type RefObject } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { readCsvFileText } from '@/lib/csv/read-file-text';

/** A button-owned hidden picker that permits selecting the same file twice. */
export function CsvImportTrigger({
  label = 'Import CSV',
  pendingLabel = 'Importing…',
  accessibleLabel,
  pending = false,
  onSelect,
  variant = 'secondary',
  size,
}: Readonly<{
  label?: ReactNode;
  pendingLabel?: ReactNode;
  accessibleLabel: string;
  pending?: boolean;
  onSelect: (file: File) => void;
  variant?: ComponentProps<typeof Button>['variant'];
  size?: ComponentProps<typeof Button>['size'];
}>) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <span className="inline-flex">
      <Button
        variant={variant}
        size={size}
        disabled={pending}
        onClick={() => inputRef.current?.click()}
      >
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

/** Shared file-selection lifecycle; parsing remains owned by the importing feature. */
export function useCsvImportFile<T>(parse: (text: string) => T) {
  const [parsed, setParsed] = useState<T | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setParsed(null);
    setFileName(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const selectFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setParsed(parse(await readCsvFileText(file)));
  };

  return { fileName, inputRef, parsed, reset, selectFile };
}

/** The consistent CSV picker; feature-owned parsers receive the selected File. */
export function CsvImportFileInput({
  inputRef,
  onSelect,
}: Readonly<{
  inputRef: RefObject<HTMLInputElement | null>;
  onSelect: (file: File | undefined) => void;
}>) {
  return (
    <label className="grid gap-2">
      <span className="type-label">CSV file</span>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        aria-label="CSV file"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          onSelect(file);
          event.currentTarget.value = '';
        }}
        className="focus-ring border-border bg-well text-foreground file:bg-background-alt file:text-foreground type-body type-control-file block w-full rounded-[var(--radius-control)] border px-2 py-2 file:me-2 file:rounded-[var(--radius-control)] file:border-0 file:px-2 file:py-1"
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
          Parsed <strong className="text-foreground">{rowCount}</strong> row
          {rowCount === 1 ? '' : 's'}
          {fileName ? ` from ${fileName}` : ''}.
        </span>
        {errorCount > 0 ? (
          <Badge variant="status" value="danger">
            {errorCount} skipped
          </Badge>
        ) : null}
      </div>
      <div className="border-border max-h-85 overflow-auto rounded-[var(--radius-control)] border">
        {children}
      </div>
    </div>
  );
}
