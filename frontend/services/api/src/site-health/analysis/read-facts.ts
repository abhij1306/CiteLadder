import { record } from '../../db/json.ts';
import { scalarText } from '../../text-order.ts';

export type Facts = Record<string, unknown>;
export { record };
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const records = (value: unknown) => list(value).map(record);
export const text = (value: unknown) => scalarText(value);
export function count(value: unknown) {
  const parsed = typeof value === 'string' ? Number(value.trim()) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}
export const textList = (value: unknown) => list(value).map(text);
