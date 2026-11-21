import type { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import type { RecordScope } from '../db/workspace-scope.ts';
import { ApiError } from '../errors.ts';
import { parseUuid } from '../http/uuid.ts';
import { bulkUpdateActionStatus, updateActionStatus } from '../opportunities/action-decisions.ts';
import { declarationView } from '../opportunities/declaration-view.ts';
import { declareAction as declareOwnedAction } from '../opportunities/declarations.ts';
import type {
  ActionBulkStatusRequest,
  ActionUserStatus,
  actionDeclarationRequestSchema,
} from '@citeladder/contracts/actions';
import { permission, type Authorized } from './permission.ts';

export const ACTIONS_WRITE = permission({ capability: 'write', scope: 'actions:write' });
type Writer = Authorized<typeof ACTIONS_WRITE>;
const KEY_MAX = policy.opportunity.opportunities.IMPLEMENTATION_IDEMPOTENCY_KEY_MAX_LEN;

const scopeOf = (actor: Writer, projectId: string | null): RecordScope => ({
  workspaceId: actor.workspaceId,
  projectId,
});

export function setActionStatus(
  db: Database,
  actor: Writer,
  projectId: string | null,
  actionId: string,
  status: ActionUserStatus,
) {
  const scope = scopeOf(actor, projectId);
  return updateActionStatus(db, scope, actionId, status, actor.userId);
}

export function setActionStatuses(
  db: Database,
  actor: Writer,
  projectId: string,
  input: ActionBulkStatusRequest,
) {
  return bulkUpdateActionStatus(
    db,
    { workspaceId: actor.workspaceId, projectId },
    input,
    actor.userId,
  );
}

export async function declareAction(
  db: Database,
  actor: Writer,
  projectId: string | null,
  actionId: string,
  input: z.output<typeof actionDeclarationRequestSchema>,
  { idempotencyKey }: { idempotencyKey: string | null },
) {
  const scope = scopeOf(actor, projectId);
  const key = idempotencyKey?.trim() ?? '';
  if (!key || (idempotencyKey ?? '').length > KEY_MAX)
    throw new ApiError(422, 'A bounded Idempotency-Key is required');
  const result = await declareOwnedAction(db, scope, actionId, actor.userId, key, {
    ...input,
    output_revision_id: input.output_revision_id ? parseUuid(input.output_revision_id) : null,
    deployment_reference: input.deployment_reference || null,
  });
  return { declaration: await declarationView(db, result.row), created: result.created };
}
