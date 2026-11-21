import type { NonEmpty } from './lists.ts';

export function compareText(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

export function textSpan(windows: NonEmpty<{ start: string; end: string }>): {
  start: string;
  end: string;
} {
  let { start, end } = windows[0];
  for (const window of windows) {
    if (compareText(window.start, start) < 0) start = window.start;
    if (compareText(window.end, end) > 0) end = window.end;
  }
  return { start, end };
}

export function stripTrailing(value: string, chars: string): string {
  let end = value.length;
  while (end > 0 && chars.includes(value[end - 1]!)) end -= 1;
  return value.slice(0, end);
}

export function stripLeading(value: string, chars: string): string {
  let start = 0;
  while (start < value.length && chars.includes(value[start]!)) start += 1;
  return value.slice(start);
}

export function scalarText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value);
  return '';
}
