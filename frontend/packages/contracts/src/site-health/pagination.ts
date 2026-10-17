import { z } from 'zod';

import { responseObject } from './core.ts';

// Opaque, filter-bound keyset cursor page envelope. `next_cursor` is null on
// the last page. There is no offset / page total field (invariant: no Free
// count side channel; stable cursors while discovery appends rows).
export const cursorPageSchema = <T extends z.ZodTypeAny>(item: T) =>
  responseObject({
    items: z.array(item),
    next_cursor: z.string().nullable(),
  });
