/** Request bodies of the Action routes; shapes and responses are the shared contracts. */
import { actionStatusUpdateRequestSchema } from '@citeladder/contracts/actions';
import { z } from 'zod';
import { policy } from '../config.ts';

/** The policy names which statuses a user may store. */
export const statusPatch = actionStatusUpdateRequestSchema.extend({
  status: z
    .string()
    .refine(
      (value) => policy.opportunity.actions.ACTION_USER_STATUSES.includes(value),
      'Status must be open or dismissed',
    )
    .pipe(actionStatusUpdateRequestSchema.shape.status),
});
