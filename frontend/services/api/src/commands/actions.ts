/** Action workflow commands: a status decision and an implementation declaration. */
import type { z } from 'zod';

import { requireCapability, type Actor } from '../auth/actor.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import { parseUuid } from '../http/uuid.ts';
import { updateActionStatus } from '../opportunities/actions.ts';
import { declarationView } from '../opportunities/declaration-view.ts';
import { declareAction as declareOwnedAction } from '../opportunities/declarations.ts';
import type { declarationCreate } from '../routes/action-contracts.ts';

const SCOPE = 'actions:write';
const KEY_MAX = policy.opportunity.opportunities.IMPLEMENTATION_IDEMPOTENCY_KEY_MAX_LEN;

export function setActionStatus(db: Database, actor: Actor, actionId: string, status: string) {
  requireCapability(actor, 'write', SCOPE);
  return updateActionStatus(db, actor.workspaceId, actionId, status, actor.userId);
}

/** A repeated key replays the recorded declaration (`created: false`). */
export async function declareAction(
  db: Database,
  actor: Actor,
  actionId: string,
  input: z.output<typeof declarationCreate>,
  { idempotencyKey }: { idempotencyKey: string | null },
) {
  requireCapability(actor, 'write', SCOPE);
  const key = idempotencyKey?.trim() ?? '';
  if (!key || (idempotencyKey ?? '').length > KEY_MAX)
    throw new ApiError(422, 'A bounded Idempotency-Key is required');
  const result = await declareOwnedAction(db, actor.workspaceId, actionId, actor.userId, key, {
    ...input,
    output_revision_id: input.output_revision_id ? parseUuid(input.output_revision_id) : null,
  });
  return { declaration: await declarationView(db, result.row), created: result.created };
}
