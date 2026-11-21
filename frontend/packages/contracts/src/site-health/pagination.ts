import { z } from 'zod';

import { responseObject } from './core.ts';

export const cursorPageSchema = <T extends z.ZodTypeAny>(item: T) =>
  responseObject({
    items: z.array(item),
    next_cursor: z.string().nullable(),
  });
