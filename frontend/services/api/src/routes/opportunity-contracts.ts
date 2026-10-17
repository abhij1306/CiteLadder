/**
 * Request bodies and server-only responses of the `opportunities` family.
 * Responses the browser reads are the shared `@citeladder/contracts` schemas.
 */
import { z } from 'zod';

export const orderUpdate = z.strictObject({
  ordered_opportunity_ids: z.array(z.uuid()),
  expected_version: z.int().min(0),
});

/** A file download publishes no JSON schema. */
export const fileResponse = z.unknown();
