import { saveBlob } from '@/lib/download';

type CsvCell = string | number | null | undefined;

function escapeCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  // A number is never a formula: "-12" must import as a negative number.
  if (typeof value === 'number') return String(value);
  const text = value;
  const risky = /^\s*[=+\-@]|^[\t\r\n]/.test(text);
  const body = risky ? `'${text}` : text;
  return /[",\n\r]/.test(body) ? `"${body.replaceAll('"', '""')}"` : body;
}

export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  return [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n');
}

export function downloadCsv(
  filename: string,
  headers: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): void {
  const blob = new Blob([`﻿${toCsv(headers, rows)}`], {
    type: 'text/csv;charset=utf-8',
  });
  saveBlob(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`);
}
