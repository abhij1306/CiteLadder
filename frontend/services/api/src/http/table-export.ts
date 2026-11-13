/**
 * CSV and Markdown tables of projected rows, as downloads.
 *
 * A cell that a spreadsheet would run as a formula is prefixed with `'`; CSV
 * quoting follows RFC 4180, and Markdown escapes the pipes and line breaks
 * that would break a table. `null` renders as an empty cell.
 *
 * A large export counts its rows first and refuses past its cap, then streams
 * keyset batches to the response, so the process holds one batch at a time.
 */
import { ApiError } from '../errors.ts';
import { getLogger } from '../logging.ts';

const logger = getLogger('api.table_export');

/** Refuses an export whose counted rows exceed the bound, before any row is read. */
export function assertExportBound(count: number, max: number) {
  if (count > max) throw new ApiError(422, 'Export exceeds configured bound; narrow the filters');
}

/**
 * Keyset batches of at most `size` rows: each read continues after the last
 * row of the previous one, and a short batch ends the export. A row past
 * `max` (rows that arrived after the count) fails the stream rather than
 * truncating the download.
 */
export async function* keysetBatches<T>({
  read,
  size,
  max,
}: {
  read: (after: T | undefined, take: number) => Promise<T[]>;
  size: number;
  max: number;
}): AsyncGenerator<T[]> {
  let after: T | undefined,
    total = 0;
  for (;;) {
    const rows = await read(after, size);
    total += rows.length;
    if (total > max) throw new ApiError(422, 'Export exceeds configured bound; narrow the filters');
    if (rows.length) yield rows;
    after = rows.at(-1);
    if (rows.length < size || !after) return;
  }
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value as string | number);
}

/** One cell's text, with spreadsheet formula injection neutralized. */
function cell(value: unknown): string {
  const text = cellText(value);
  return /^[\t\r\n]/u.test(text) || /^[ \t\r\n\v\f]*[=+@-]/u.test(text) ? `'${text}` : text;
}

function csvLine(columns: readonly string[], item: Record<string, unknown>): string {
  const quote = (text: string) =>
    /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  return columns.map((c) => quote(cell(item[c]))).join(',') + '\r\n';
}

export function tableCsv(columns: readonly string[], items: Record<string, unknown>[]): string {
  return columns.join(',') + '\r\n' + items.map((item) => csvLine(columns, item)).join('');
}

/**
 * The same CSV as `tableCsv`, encoded one batch at a time as the client
 * reads: the next batch is not requested until the previous one is taken.
 * The status was sent with the first byte, so a batch that fails ends the
 * download and leaves only its log record.
 */
function csvStream(
  filename: string,
  columns: readonly string[],
  batches: AsyncIterable<Record<string, unknown>[]>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder(),
    iterator = batches[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(columns.join(',') + '\r\n'));
    },
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else
          controller.enqueue(encoder.encode(next.value.map((i) => csvLine(columns, i)).join('')));
      } catch (error) {
        logger.exception('table_export_failed', error, { filename });
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

/** A streamed CSV download. */
export function csvDownload(
  filename: string,
  columns: readonly string[],
  batches: AsyncIterable<Record<string, unknown>[]>,
) {
  return new Response(csvStream(filename, columns, batches), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
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
