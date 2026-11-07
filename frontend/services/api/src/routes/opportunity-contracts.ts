/**
 * Request bodies and server-only responses of the `opportunities` family.
 * Responses the browser reads are the shared `@citeladder/contracts` schemas.
 */
import { z } from 'zod';

/** A file download publishes no JSON schema. */
export const fileResponse = z.unknown();
