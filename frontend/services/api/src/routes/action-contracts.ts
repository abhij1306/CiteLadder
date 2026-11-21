import {
  actionStatusUpdateRequestSchema,
  actionUserStatusSchema,
} from '@citeladder/contracts/actions';
import { z } from 'zod';

export const statusPatch = actionStatusUpdateRequestSchema.extend({
  status: z
    .string()
    .refine(
      (value) => actionUserStatusSchema.safeParse(value).success,
      'Status must be in_progress, dismissed or open',
    )
    .pipe(actionUserStatusSchema),
});
