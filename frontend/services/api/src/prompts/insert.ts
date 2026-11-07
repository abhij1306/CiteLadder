/**
 * The one prompt insert path: manual create, import, candidate accept and
 * Commerce buyer prompts all write `prompts` rows here.
 *
 * `insertPrompts` takes the documented locks in order (project → set,
 * `locks.ts`), drops rows equivalent to an earlier row or to a prompt already
 * in the set, and derives `branded`, `status` and `origin` itself. Callers that
 * already hold the project and set locks lose nothing: transaction-scoped
 * advisory locks are re-entrant. The per-set hash uniqueness stays the final
 * race guard.
 */
import { randomUUID } from 'node:crypto';

import type { promptCohortSchema } from '@citeladder/contracts/project';
import type { Kysely } from 'kysely';
import type { z } from 'zod';

import { policy } from '../config.ts';
import { ApiError } from '../errors.ts';
import type { DB } from '../generated/db-schema.ts';
import { acquireProjectLock, acquirePromptSetLock } from './locks.ts';
import { promptTextHash } from './normalization.ts';
import type { PromptRow } from './views.ts';

const P = policy.prompts;
const BRANDED = new Set(P.branded_cohorts);
const UNIQUE_TEXT = 'uq_prompt_set_normalized_text';
export const DUPLICATE_PROMPT = 'An equivalent prompt already exists in this set';

type Cohort = z.infer<typeof promptCohortSchema>;

/** What a caller decides about one prompt; the rest is derived here. */
export type PromptDraft = {
  text: string;
  topic_id: string | null;
  theme: string;
  intent: string;
  buyer_stage: string;
  prompt_intent?: string;
  persona: string;
  cohort: Cohort;
  enabled: boolean;
  generation_evidence?: Record<string, unknown> | null;
};

type InsertOptions = {
  origin: keyof typeof P.origins;
  /** `reject` refuses the whole batch with a 409; `skip` leaves that row out. */
  onDuplicate: 'reject' | 'skip';
};

/** Branded follows the cohort: a prompt naming the business is never organic. */
export const brandedCohort = (cohort: Cohort): boolean => BRANDED.has(cohort);

/**
 * Insert `drafts` into the set; the result is aligned with `drafts`, `null`
 * for a row left out as a duplicate. Rows are created a millisecond apart so
 * creation-ordered lists keep the caller's order.
 */
export async function insertPrompts(
  trx: Kysely<DB>,
  set: { id: string; project_id: string; workspace_id: string },
  drafts: readonly PromptDraft[],
  options: InsertOptions,
): Promise<(PromptRow | null)[]> {
  await acquireProjectLock(trx, set.project_id);
  await acquirePromptSetLock(trx, set.id);
  const hashes = drafts.map((draft) => promptTextHash(draft.text));
  const taken = new Set(
    hashes.length === 0
      ? []
      : (
          await trx
            .selectFrom('prompts')
            .select('normalized_text_hash')
            .where('prompt_set_id', '=', set.id)
            .where('normalized_text_hash', 'in', hashes)
            .execute()
        ).map((row) => row.normalized_text_hash),
  );
  const planned = drafts.map((draft, index) => {
    const hash = hashes[index]!;
    if (taken.has(hash)) return null;
    taken.add(hash);
    return { draft, hash, id: randomUUID() };
  });
  const insertable = planned.filter((row) => row !== null);
  if (options.onDuplicate === 'reject' && insertable.length !== drafts.length) {
    throw new ApiError(409, DUPLICATE_PROMPT);
  }
  if (insertable.length === 0) return planned.map(() => null);
  const now = new Date();
  const rows = await trx
    .insertInto('prompts')
    .values(
      insertable.map(({ draft, hash, id }, index) => ({
        id,
        workspace_id: set.workspace_id,
        prompt_set_id: set.id,
        topic_id: draft.topic_id,
        text: draft.text,
        normalized_text_hash: hash,
        theme: draft.theme,
        intent: draft.intent,
        buyer_stage: draft.buyer_stage,
        ...(draft.prompt_intent === undefined ? {} : { prompt_intent: draft.prompt_intent }),
        persona: draft.persona,
        cohort: draft.cohort,
        branded: brandedCohort(draft.cohort),
        enabled: draft.enabled,
        status: P.status_active,
        origin: P.origins[options.origin],
        generation_evidence:
          draft.generation_evidence == null ? null : JSON.stringify(draft.generation_evidence),
        created_at: new Date(now.getTime() + index),
        updated_at: now,
      })),
    )
    .onConflict((conflict) => conflict.constraint(UNIQUE_TEXT).doNothing())
    .returningAll()
    .execute();
  // A racing writer that slipped past the screen above: the unique index decides.
  if (options.onDuplicate === 'reject' && rows.length !== insertable.length) {
    throw new ApiError(409, DUPLICATE_PROMPT);
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  return planned.map((row) => (row === null ? null : (byId.get(row.id) ?? null)));
}
