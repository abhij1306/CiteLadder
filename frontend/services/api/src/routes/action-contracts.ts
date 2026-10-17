/** Request bodies of the Action routes; responses are the shared contracts. */
import { z } from 'zod';
import { policy } from '../config.ts';

const datetime = z.iso.datetime({ offset: true });
const nullableUuid = z.uuid().nullable();
export const statusPatch = z.strictObject({
  status: z
    .string()
    .refine(
      (value) => policy.opportunity.actions.ACTION_USER_STATUSES.includes(value),
      'Status must be open or dismissed',
    ),
});
export const declarationCreate = z.strictObject({
  recommendation_ids: z.array(z.uuid()).max(100).default([]),
  output_revision_id: nullableUuid.default(null),
  declared_implemented_at: datetime.refine(
    (value) => !value.startsWith('0000-'),
    'A valid calendar year is required',
  ),
});
