import { getDomain } from 'tldts';
import { z } from 'zod';
import { costMicrousd } from '../providers/dataforseo.ts';
import { lenient, list, listOf, opaque, withRaw } from '../lenient-fields.ts';
import { searchPolicy } from './dataforseo.ts';

export const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
export const integer = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;
export const domain = (value: string) => getDomain(value) ?? '';
export const kind = lenient((value) => (typeof value === 'string' ? value : ''));
export const pending = (status: number | null) =>
  status !== null && searchPolicy.constants.pending_task_status_codes.includes(status);

function observedAt(value: unknown) {
  const raw = text(value).replace(' +00:00', 'Z');
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

const stamp = z
  .object({ datetime: opaque, time: opaque })
  .transform(({ datetime, time }) => ({ observed_at: observedAt(datetime || time) }));

export const stamped = <S extends z.ZodRawShape>(shape: S) => z.object(shape).and(stamp);

const taskSchema = withRaw(
  stamped({
    id: z.union([z.string(), z.number(), z.boolean()]).optional().catch(undefined),
    status_code: lenient(integer),
    cost: lenient(costMicrousd),
    result: lenient(list),
  }),
);

export const envelopeSchema = withRaw(
  z.object({ status_code: lenient(integer), tasks: listOf(taskSchema) }),
);

export const emptyUsage = {
  uncached_input_tokens: null,
  cached_input_tokens: null,
  output_tokens: null,
  reasoning_tokens: null,
  total_tokens: null,
  web_search_requests: null,
  provider_cost_microusd: null,
};
