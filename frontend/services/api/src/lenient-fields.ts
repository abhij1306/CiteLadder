import { z } from 'zod';
import { isRecord, record } from './db/json.ts';

export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const lenient = <T>(read: (value: unknown) => T) => z.unknown().optional().transform(read);

export const opaque = z.unknown().optional();

export const within = <S extends z.ZodType<unknown, Record<string, unknown>>>(schema: S) =>
  lenient(record).pipe(schema);

export const nested = <S extends z.ZodRawShape>(shape: S) => within(z.object(shape));

export const recordsOf = <S extends z.ZodType>(schema: S, value: unknown) =>
  list(value)
    .filter(isRecord)
    .map((item): z.output<S> => schema.parse(item));

export const listOf = <S extends z.ZodType>(schema: S) =>
  lenient((value) => recordsOf(schema, value));

export const withRaw = <S extends z.ZodType<object>>(schema: S) =>
  lenient(record).transform((raw) => ({ ...schema.parse(raw), raw }));
