import { randomUUID } from 'node:crypto';
import type { Insertable, Selectable } from 'kysely';
import {
  parseLogLine,
  UnsupportedLogFormat,
  type LogMapping,
  type MappedLog,
} from '@citeladder/contracts/crawl-log-format';
import type { BotRequests, CrawlLogSources, BotIpRangeSnapshots } from '../generated/db-schema.ts';
import { crawlLogs } from '../config/crawl-logs.ts';
import { crawlers, matchesCrawlerUserAgent } from '../config/crawlers.ts';
import { strings } from '../db/json.ts';
import { hash } from '../traffic/normalization.ts';
import { pathIdentity, verifyBot } from './identity.ts';

type Input = {
  source: Selectable<CrawlLogSources>;
  lines: string[];
  preset: LogMapping;
  format: string;
  latest: Map<string, Selectable<BotIpRangeSnapshots>>;
  now: Date;
};
function requestHost(mapped: MappedLog, source: Input['source']) {
  try {
    const base = new URL(source.origin);
    if (mapped.host) {
      base.hostname = mapped.host;
      if (base.hostname !== mapped.host.toLowerCase())
        return { kind: 'lines_out_of_scope' as const };
    }
    const target = new URL(mapped.path, base.origin);
    const host = target.hostname.toLowerCase();
    if (
      (mapped.host && host !== mapped.host.toLowerCase()) ||
      !strings(source.accepted_hosts).includes(host)
    )
      return { kind: 'lines_out_of_scope' as const };
    return { kind: 'accepted' as const, host, origin: target.origin };
  } catch {
    return { kind: 'lines_rejected' as const };
  }
}
function prepareLine(line: string, input: Input) {
  const { source, preset, format, now, latest } = input;
  if (Buffer.byteLength(line) > crawlLogs.max_line_bytes)
    return { kind: 'lines_rejected' as const, at: null };
  const mapped = parseLogLine(line, format, preset);
  if (!mapped) return { kind: 'lines_rejected' as const, at: null };
  const at = new Date(mapped.timestamp);
  if (
    at.getTime() > now.getTime() + crawlLogs.max_clock_skew_hours * 3600000 ||
    at.getTime() < now.getTime() - crawlLogs.max_backdate_days * 86400000
  )
    return { kind: 'lines_rejected' as const, at: null };
  const bot = crawlers.bots.find((bot) => matchesCrawlerUserAgent(bot, mapped.user_agent));
  if (!bot) return { kind: 'lines_unmatched' as const, at };
  const host = requestHost(mapped, source);
  if (host.kind !== 'accepted') return { ...host, at };
  const identity = pathIdentity(mapped.path, host.origin);
  if (!identity || (mapped.request_id?.length ?? 0) > 255)
    return { kind: 'lines_rejected' as const, at };
  const row: Insertable<BotRequests> = {
    id: randomUUID(),
    workspace_id: source.workspace_id,
    project_id: source.project_id,
    source_id: source.id,
    batch_id: '',
    occurred_at: at,
    host: host.host,
    ...identity,
    method: mapped.method,
    status_code: mapped.status,
    bot_id: bot.bot_id,
    catalog_version: crawlers.catalog_version,
    ...verifyBot(bot, mapped.client_ip, latest.get(bot.bot_id), at, now),
    provider_request_id: mapped.request_id || null,
    line_hash: hash(JSON.stringify([source.id, mapped])),
  };
  return { kind: 'prepared' as const, at, row };
}
/** A line without the identifying fields is rejected on its own, not with its batch. */
function prepareLineOrFormatError(line: string, input: Input) {
  try {
    return prepareLine(line, input);
  } catch (error) {
    if (error instanceof UnsupportedLogFormat) return error;
    throw error;
  }
}
/** CPU-only parsing and sanitization; transient input is never persisted here. */
export function prepareBatch(input: Input) {
  const counts = {
    lines_received: input.lines.length,
    lines_parsed: 0,
    lines_matched: 0,
    lines_unmatched: 0,
    lines_out_of_scope: 0,
    lines_rejected: 0,
    lines_duplicate: 0,
    lines_overlapping: 0,
  };
  const prepared: Insertable<BotRequests>[] = [];
  let first: Date | null = null,
    last: Date | null = null,
    unsupported: UnsupportedLogFormat | null = null,
    formatErrors = 0;
  for (const line of input.lines) {
    const result = prepareLineOrFormatError(line, input);
    if (result instanceof UnsupportedLogFormat) {
      unsupported ??= result;
      formatErrors++;
      counts.lines_rejected++;
      continue;
    }
    if (result.at) {
      counts.lines_parsed++;
      if (first === null || result.at < first) first = result.at;
      if (last === null || result.at > last) last = result.at;
    }
    if (result.kind === 'prepared') prepared.push(result.row);
    else counts[result.kind]++;
  }
  // The batch is unsupported only when no line carried the fields at all.
  if (formatErrors < input.lines.length) unsupported = null;
  return { counts, prepared, first, last, unsupported };
}
