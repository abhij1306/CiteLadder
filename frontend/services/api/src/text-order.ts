import type { NonEmpty } from './lists.ts';

/** Deterministic code-unit order for persisted keys and IDs; never locale-sensitive. */
export function compareText(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/** The earliest start and latest end across text-dated windows, in `compareText` order. */
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

/** `value` without any trailing run of the characters in `chars`, in linear time. */
export function stripTrailing(value: string, chars: string): string {
  let end = value.length;
  while (end > 0 && chars.includes(value[end - 1]!)) end -= 1;
  return value.slice(0, end);
}

/** `value` without any leading run of the characters in `chars`, in linear time. */
export function stripLeading(value: string, chars: string): string {
  let start = 0;
  while (start < value.length && chars.includes(value[start]!)) start += 1;
  return value.slice(start);
}

/** Stored scalar evidence as text; objects, arrays and absent values carry no text. */
export function scalarText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value);
  return '';
}
