import {
  parseLogLine,
  UnsupportedLogFormat,
  type LogMapping,
} from '@citeladder/contracts/crawl-log-format';
import { matchesCrawlerUserAgent, type crawlCatalogSchema } from '@citeladder/contracts/ai-traffic';
import type { z } from 'zod';
import { aiTrafficApi } from '@/lib/api/ai-traffic';
import type { ApiRequestOptions } from '@/lib/api/client';

type Catalog = z.infer<typeof crawlCatalogSchema>;
/** A bounded JSON-array state machine retaining only the current object. */
class JsonObjectArray {
  private pending = '';
  private depth = 0;
  private quoted = false;
  private escaped = false;
  private started = false;
  private ended = false;
  private needComma = false;
  private afterComma = false;
  constructor(private readonly maxLineBytes: number) {}
  push(char: string): string | null {
    if (!this.depth) return this.outside(char);
    this.pending += char;
    this.advance(char);
    if (this.pending.length > this.maxLineBytes) throw new Error('Log line exceeds upload limit');
    if (this.depth) return null;
    assertLineBound(this.pending, this.maxLineBytes);
    const line = this.pending;
    this.pending = '';
    this.needComma = true;
    return line;
  }
  private outside(char: string): null {
    if (/\s/u.test(char)) return null;
    if (!this.started) {
      if (char !== '[') throw new UnsupportedLogFormat(['json_array']);
      this.started = true;
      return null;
    }
    if (this.ended) throw new Error('Data after JSON array');
    if (char === ']') {
      if (this.afterComma) throw new Error('Trailing JSON array comma');
      this.ended = true;
      return null;
    }
    if (char === ',') {
      if (!this.needComma) throw new Error('Unexpected JSON array comma');
      this.needComma = false;
      this.afterComma = true;
      return null;
    }
    if (this.needComma) throw new Error('Missing JSON array comma');
    if (char !== '{') throw new UnsupportedLogFormat(['json_array_objects']);
    this.pending = char;
    this.depth = 1;
    this.afterComma = false;
    return null;
  }
  private advance(char: string) {
    if (this.escaped) {
      this.escaped = false;
      return;
    }
    if (this.quoted) {
      if (char === '\\') this.escaped = true;
      else if (char === '"') this.quoted = false;
      return;
    }
    if (char === '"') this.quoted = true;
    else if (char === '{' || char === '[') this.depth++;
    else if (char === '}' || char === ']') this.depth--;
  }
  finish() {
    if (!this.ended || this.depth) throw new Error('Incomplete JSON array');
  }
}
function assertLineBound(line: string, max: number) {
  if (new TextEncoder().encode(line).length > max) throw new Error('Log line exceeds upload limit');
}
async function* textRecords(reader: ReadableStreamDefaultReader<string>, max: number) {
  let pending = '';
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    pending += part.value;
    let newline: number;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline).replace(/\r$/u, '');
      pending = pending.slice(newline + 1);
      assertLineBound(line, max);
      if (line.trim()) yield line;
    }
    assertLineBound(pending, max);
  }
  if (pending.trim()) yield pending;
}
async function* arrayRecords(reader: ReadableStreamDefaultReader<string>, max: number) {
  const records = new JsonObjectArray(max);
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    for (const char of part.value) {
      const line = records.push(char);
      if (line !== null) yield line;
    }
  }
  records.finish();
}
/** Streaming decoding never buffers a whole file or JSON array. */
async function* fileLines(file: File, format: string, max: number) {
  let bytes: ReadableStream<BufferSource> = file.stream();
  if (file.name.endsWith('.gz')) bytes = bytes.pipeThrough(new DecompressionStream('gzip'));
  const reader = bytes.pipeThrough(new TextDecoderStream('utf-8', { fatal: true })).getReader();
  try {
    if (format === 'json_array') yield* arrayRecords(reader, max);
    else yield* textRecords(reader, max);
  } finally {
    await reader.cancel();
  }
}
/** A line without the identifying fields is skipped, as the server rejects it alone. */
function mappedLine(line: string, format: string, mapping: LogMapping) {
  try {
    return parseLogLine(line, format, mapping);
  } catch (error) {
    if (error instanceof UnsupportedLogFormat) return null;
    throw error;
  }
}
async function headerSample(
  iterator: AsyncIterator<string>,
  format: string,
  mapping: LogMapping,
  limit: number,
) {
  const sample: string[] = [];
  for (let i = 0; i < limit; i++) {
    const next = await iterator.next();
    if (next.done) break;
    sample.push(next.value);
  }
  if (!sample.some((line) => mappedLine(line, format, mapping)))
    throw new UnsupportedLogFormat(['timestamp', 'path', 'user_agent']);
  return sample;
}
type Scan = {
  first: string | null;
  last: string | null;
  dates: Set<string>;
};
function trackScan(scan: Scan, timestamp: string) {
  const at = new Date(timestamp).toISOString(),
    day = at.slice(0, 10);
  if (!scan.first || at < scan.first) scan.first = at;
  if (!scan.last || at > scan.last) scan.last = at;
  scan.dates.add(day);
  return at;
}
export async function uploadCrawlFile(input: {
  file: File;
  format: string;
  mapping: LogMapping;
  catalog: Catalog;
  projectId: string;
  sourceId: string;
  resumeId?: string;
  options: ApiRequestOptions;
  onProgress: (value: { uploadId: string; scanned: number; matched: number }) => void;
}) {
  const { file, format, mapping, catalog, projectId, sourceId, options } = input;
  const iterator = fileLines(file, format, catalog.max_line_bytes)[Symbol.asyncIterator]();
  try {
    const sample = await headerSample(iterator, format, mapping, catalog.upload_sample_lines);
    const upload = input.resumeId
      ? await aiTrafficApi.uploadStatus(projectId, sourceId, input.resumeId, options)
      : await aiTrafficApi.createUpload(projectId, sourceId, file.name, file.size, options);
    if (upload.status !== 'open') throw new Error('Upload is closed');
    if (input.resumeId && (upload.filename !== file.name || upload.size_bytes !== file.size))
      throw new Error('Resume requires the original file');
    // Reported before the first batch, so a failure there can still be resumed.
    input.onProgress({ uploadId: upload.id, scanned: 0, matched: 0 });
    let scanned = 0,
      matched = 0,
      seq = 0,
      batch: string[] = [],
      batchBytes = 0;
    const scan: Scan = { first: null, last: null, dates: new Set<string>() };
    // Lines older than the admission window are neither sent nor counted in the scan span.
    // The floor is fixed when the upload is created, so a resumed scan batches identically.
    const oldest = new Date(
      Date.parse(upload.created_at) - catalog.max_backdate_days * 86400000,
    ).toISOString();
    const envelopeBytes = () => new TextEncoder().encode(JSON.stringify({ seq, lines: [] })).length;
    let envelope = envelopeBytes();
    const flush = async () => {
      if (!batch.length) return;
      if (seq > upload.last_ack_seq)
        await aiTrafficApi.uploadBatch(projectId, sourceId, upload.id, seq, batch, options);
      seq++;
      envelope = envelopeBytes();
      batch = [];
      batchBytes = 0;
      input.onProgress({ uploadId: upload.id, scanned, matched });
    };
    async function consume(line: string) {
      if (options.signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
      scanned++;
      const row = mappedLine(line, format, mapping);
      if (!row || new Date(row.timestamp).toISOString() < oldest) return;
      const at = trackScan(scan, row.timestamp);
      if (!catalog.bots.some((bot) => matchesCrawlerUserAgent(bot, row.user_agent))) return;
      const normalized = JSON.stringify({ ...row, timestamp: at });
      const size = new TextEncoder().encode(normalized).length;
      if (size > catalog.max_line_bytes) throw new Error('Mapped log line exceeds limit');
      const wireSize = new TextEncoder().encode(JSON.stringify(normalized)).length + 1;
      if (
        batch.length >= catalog.max_lines_per_batch ||
        batchBytes + wireSize + envelope > catalog.max_batch_bytes
      )
        await flush();
      batch.push(normalized);
      batchBytes += wireSize;
      matched++;
    }
    for (const line of sample) await consume(line);
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      await consume(next.value);
    }
    if (!scan.first)
      throw new Error(`No log lines from the last ${catalog.max_backdate_days} days to upload`);
    await flush();
    await aiTrafficApi.completeUpload(
      projectId,
      sourceId,
      upload.id,
      {
        scanned_lines: scanned,
        first_line_at: scan.first,
        last_line_at: scan.last,
        scanned_dates: [...scan.dates],
      },
      options,
    );
    input.onProgress({ uploadId: upload.id, scanned, matched });
    return { uploadId: upload.id, scanned, matched };
  } finally {
    await iterator.return?.();
  }
}
