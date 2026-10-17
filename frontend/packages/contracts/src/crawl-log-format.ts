/** Shared, bounded log parsing for server admission and local upload filtering. */
export type LogMapping = {
  timestamp: string;
  host: string;
  path: string;
  method: string;
  status: string;
  user_agent: string;
  client_ip: string;
  request_id: string;
  timestamp_unit: 'iso' | 'seconds' | 'milliseconds' | 'nanoseconds';
  /** UTC `YYYY-MM-DD` and `HH:MM:SS` fields used when the timestamp field is absent. */
  timestamp_fallback?: { date: string; time: string };
  /** Field values that mean "absent" (CloudFront writes `-`). */
  missing_tokens?: readonly string[];
  /** `url`: the user agent arrives percent-encoded (CloudFront `cs(User-Agent)`). */
  user_agent_decode?: 'url';
};
type MappedField =
  | 'timestamp'
  | 'host'
  | 'path'
  | 'method'
  | 'status'
  | 'user_agent'
  | 'client_ip'
  | 'request_id';
export type MappedLog = {
  timestamp: string;
  host: string | null;
  path: string;
  method: string;
  status: number;
  user_agent: string;
  client_ip: string | null;
  request_id: string | null;
};
export class UnsupportedLogFormat extends Error {
  readonly missing_fields: string[];
  constructor(missing_fields: string[]) {
    super('This log format does not contain the fields needed for crawler identification.');
    this.missing_fields = missing_fields;
  }
}
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function combined(line: string): Record<string, unknown> | null {
  const match =
    /^(\S+) \S+ \S+ \[([^\]]+)\] "([A-Z]+) ([^"]+) HTTP\/[\d.]+" (\d{3}) (?:\d+|-) "[^"]*" "([^"]*)"\s*$/u.exec(
      line,
    );
  if (!match) return null;
  // Every group takes part in a match, so the defaults never apply.
  const [, clientIp, stamp = '', method, path, status, userAgent] = match;
  const date = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}:\d{2}:\d{2}) ([+-]\d{4})$/u.exec(stamp);
  if (!date) return null;
  const [, day, monthName = '', year, time, offset = ''] = date;
  const month = months.indexOf(monthName);
  if (month < 0) return null;
  return {
    client_ip: clientIp,
    timestamp: `${year}-${String(month + 1).padStart(2, '0')}-${day}T${time}${offset.slice(0, 3)}:${offset.slice(3)}`,
    method,
    path,
    status: Number(status),
    user_agent: userAgent,
  };
}
function logValue(line: string, format: string): unknown {
  if (format === 'combined') {
    const value = combined(line);
    if (!value && /^\S+ \S+ \S+ \[[^\]]+\] "[^"]+" \d{3} (?:\d+|-)\s*$/u.test(line))
      throw new UnsupportedLogFormat(['user_agent']);
    return value;
  }
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
/** An epoch number, or its decimal string form (CloudFront sends `"1700000000123"`). */
function epochNumber(value: unknown) {
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/u.test(value)) return Number(value);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function logTimestamp(value: unknown, unit: LogMapping['timestamp_unit']) {
  let timestamp = String(value);
  if (unit !== 'iso') {
    const epoch = epochNumber(value);
    if (epoch === null) return null;
    const ms = epoch * { seconds: 1000, milliseconds: 1, nanoseconds: 1e-6 }[unit];
    if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return null;
    timestamp = new Date(ms).toISOString();
  }
  // Require an explicit timezone; machine-local parsing is never evidence.
  return /(?:Z|[+-]\d{2}:\d{2})$/u.test(timestamp) && Number.isFinite(Date.parse(timestamp))
    ? timestamp
    : null;
}
/** UTC date and time fields as one ISO timestamp, or absent; a calendar-impossible value is absent. */
function fallbackTimestamp(date: unknown, time: unknown) {
  if (
    typeof date !== 'string' ||
    typeof time !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
    !/^\d{2}:\d{2}:\d{2}$/u.test(time)
  )
    return undefined;
  const stamp = `${date}T${time}`;
  const parsed = Date.parse(stamp + 'Z');
  // Date normalizes 2026-02-31 into March; only a value that round-trips is a real instant.
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === stamp
    ? stamp + 'Z'
    : undefined;
}
function decodedUserAgent(value: string, decode: LogMapping['user_agent_decode']) {
  if (decode !== 'url') return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
function logStatus(value: unknown) {
  const status = typeof value === 'string' && /^\d{3}$/u.test(value) ? Number(value) : value;
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : null;
}
export function parseLogLine(line: string, format: string, mapping: LogMapping): MappedLog | null {
  const value = logValue(line, format);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const absent = new Set(mapping.missing_tokens ?? []);
  const read = (name: string) => {
    const raw = row[name];
    return typeof raw === 'string' && absent.has(raw) ? undefined : raw;
  };
  const fallback = mapping.timestamp_fallback;
  const usesFallback =
    format !== 'combined' && fallback !== undefined && read(mapping.timestamp) === undefined;
  const field = (key: MappedField) => {
    if (format === 'combined') return row[key];
    if (key === 'timestamp' && usesFallback)
      return fallbackTimestamp(read(fallback.date), read(fallback.time));
    return read(mapping[key]);
  };
  const missing = (['timestamp', 'path', 'user_agent'] as const).filter(
    (key) =>
      typeof field(key) !== 'string' && !(key === 'timestamp' && typeof field(key) === 'number'),
  );
  if (missing.length) throw new UnsupportedLogFormat(missing);
  // A fallback date and time is already ISO, whatever the primary field's unit.
  const iso = format === 'combined' || usesFallback;
  const timestamp = logTimestamp(field('timestamp'), iso ? 'iso' : mapping.timestamp_unit);
  const status = logStatus(field('status'));
  if (timestamp === null || status === null) return null;
  const text = (key: MappedField) => (typeof field(key) === 'string' ? String(field(key)) : null);
  const path = text('path')!;
  const method = text('method');
  if (!method || !/^[A-Z]{1,16}$/u.test(method) || !path) return null;
  return {
    timestamp,
    path,
    method,
    status,
    user_agent: decodedUserAgent(text('user_agent')!, mapping.user_agent_decode),
    host: text('host'),
    client_ip: text('client_ip'),
    request_id: text('request_id'),
  };
}
export function logLines(body: string, format: string, maxLines: number): string[] {
  if (!body.trim()) return [];
  let lines: string[];
  if (format === 'json_array') {
    let rows: unknown;
    try {
      rows = JSON.parse(body);
    } catch {
      throw new UnsupportedLogFormat(['json_array']);
    }
    if (!Array.isArray(rows)) throw new UnsupportedLogFormat(['json_array']);
    if (rows.length > maxLines) throw new RangeError('Too many log lines');
    lines = rows.map((row) => JSON.stringify(row));
  } else lines = body.split(/\r?\n/u).filter((line) => line.trim());
  if (lines.length > maxLines) throw new RangeError('Too many log lines');
  return lines;
}
