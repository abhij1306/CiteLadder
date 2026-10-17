import { z } from 'zod';

// ---------------------------------------------------------------------------
// The entity-presence shape an inspected page carries.
//
// Read through an earned Action's brief and a cited URL's page. Every field is a persisted projection: the backend never
// fetches on a read, so a page nobody has inspected carries no entities at all
// — which is NOT an absence, and no surface may render it as one.
// ---------------------------------------------------------------------------

/**
 * One entity's verdict on one page.
 *
 * `state` deliberately mixes page-level outcomes (`not_inspected`, `blocked`,
 * `stale`) with the presence verdicts (`present`, `not_detected`, `ambiguous`,
 * `partial`). The backend resolves the two into one vocabulary so a reader
 * cannot be handed a stale verdict as a current one.
 *
 * `passages` is the quoted line that proves a positive finding. It is empty
 * for anything else, because no passage can demonstrate an absence — that is
 * what `match_method` and the page's `extracted_chars` are for.
 */
const pageEntityFields = {
  entity_kind: z.string(),
  entity_name: z.string(),
  match_method: z.string(),
  match_count: z.number().int(),
  passages: z.array(z.string()),
} as const;

/** One entity's verdict on a page as the brief and the URL page carry it. */
export const pageEntitySchema = z.object({
  ...pageEntityFields,
  presence: z.string(),
});
