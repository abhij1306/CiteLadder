/**
 * CSV and Markdown tables of projected rows, as downloads.
 *
 * A cell that a spreadsheet would run as a formula is prefixed with `'`; CSV
 * quoting follows RFC 4180, and Markdown escapes the pipes and line breaks
 * that would break a table. `null` renders as an empty cell.
 */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value as string | number);
}

/** One cell's text, with spreadsheet formula injection neutralized. */
function cell(value: unknown): string {
  const text = cellText(value);
  return /^[\t\r\n]/u.test(text) || /^[ \t\r\n\v\f]*[=+@-]/u.test(text) ? `'${text}` : text;
}

export function tableCsv(columns: readonly string[], items: Record<string, unknown>[]): string {
  const quote = (text: string) =>
    /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  return (
    [
      columns.join(','),
      ...items.map((item) => columns.map((c) => quote(cell(item[c]))).join(',')),
    ].join('\r\n') + '\r\n'
  );
}

export function tableMarkdown(
  title: string,
  columns: readonly string[],
  items: Record<string, unknown>[],
): string {
  const escape = (value: unknown) =>
    cell(value)
      .replaceAll(/[\\|]/gu, String.raw`\$&`)
      .replaceAll(/[\r\n]/gu, ' ');
  return [
    `# ${title}`,
    '',
    `| ${columns.join(' | ')} |`,
    `|${columns.map(() => '---').join('|')}|`,
    ...items.map((item) => `| ${columns.map((c) => escape(item[c])).join(' | ')} |`),
    '',
  ].join('\n');
}
