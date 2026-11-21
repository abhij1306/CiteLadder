import { randomUUIDv7 } from 'node:crypto';

export const timeOrderedId = (): string => randomUUIDv7();
