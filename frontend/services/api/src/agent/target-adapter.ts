import type { Selectable } from 'kysely';
import type { Database } from '../db/database.ts';
import type { AgentOutputs } from '../generated/db-schema.ts';
import { refreshActionStatus } from '../opportunities/action-status.ts';
import { acquireProjectLock } from '../prompts/locks.ts';
import { attachOrCreateAction } from '../opportunities/actions.ts';
import {
  ActionTargetError,
  isAgentTargetKind,
  namedTarget,
  type AgentTargetKind,
} from '../opportunities/targets/registry.ts';
import { AgentError, type Chat, type OutputPayload, type Scope } from './contracts.ts';
import type { AttachTarget } from './outputs.ts';

type Output = Selectable<AgentOutputs>;
type NamedTarget = { kind: AgentTargetKind; target: string };
/** The longest target a document can hold for the person's choice (`agent_outputs.target_label`). */
const NAMED_TARGET_MAX_CHARS = 255;

/** `work`'s result, or null for a target no Action can carry (`ActionTargetError`). */
async function unlessInvalidTarget<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof ActionTargetError) return null;
    throw error;
  }
}

function payloadTarget(payload: OutputPayload): NamedTarget | null {
  const target = payload.target?.trim();
  return payload.target_kind && target ? { kind: payload.target_kind, target } : null;
}

/**
 * Invalid suggested targets preserve the deliverable for explicit retargeting.
 * A document without an Action attaches to the one its target names, and a
 * chat without one takes the first document's Action. A document that already
 * carries an Action (its chat's) records the page it names once: the Action's
 * own target when it is the same Action, else the named target, which the
 * person links to or declines (`chooseOutputTarget`).
 */
export const attachAgentTarget: AttachTarget = async (db, chat, output, payload, userId) => {
  const named = payloadTarget(payload);
  if (!named) return;
  if (output.action_id) {
    await recordNamedTarget(db, chat, output, output.action_id, named);
    return;
  }
  const action = await unlessInvalidTarget(
    attachOrCreateAction(db, ownerOf(chat), named.kind, named.target, userId),
  );
  if (!action) return;
  await db
    .updateTable('agent_chats')
    .set({ action_id: action.id })
    .where('workspace_id', '=', chat.workspace_id)
    .where('project_id', '=', chat.project_id)
    .where('id', '=', chat.id)
    .where('action_id', 'is', null)
    .execute();
  await setOutputAction(db, chat, output.id, action);
};

/** A document records what it names once; a later revision does not reopen the choice. */
async function recordNamedTarget(
  db: Database,
  chat: Chat,
  output: Output,
  actionId: string,
  named: NamedTarget,
) {
  if (output.target_kind !== null) return;
  const action = await outputAction(db, chat, actionId);
  const identity = await unlessInvalidTarget(
    namedTarget(db, ownerOf(chat), named.kind, named.target),
  );
  if (identity === null) return;
  if (identity.key === action.group_key) {
    await setOutputAction(db, chat, output.id, action);
    return;
  }
  if (named.target.length > NAMED_TARGET_MAX_CHARS) return;
  await db
    .updateTable('agent_outputs')
    .set({ target_kind: named.kind, target_label: named.target })
    .where('workspace_id', '=', chat.workspace_id)
    .where('project_id', '=', chat.project_id)
    .where('id', '=', output.id)
    .execute();
}

/**
 * The person's answer to a document that names another page than its Action:
 * `link` re-attaches the document to the named page's Action (created when
 * none exists), `keep` keeps it with its Action. Either settles the choice.
 * A document whose revision anchors its Action's declaration stays with it.
 * Caller owns the transaction, authorized, with the chat locked and idle.
 */
export async function chooseOutputTarget(
  db: Database,
  scope: Scope,
  chat: Chat,
  outputId: string,
  decision: 'link' | 'keep',
) {
  const output = await db
    .selectFrom('agent_outputs')
    .selectAll()
    .where('workspace_id', '=', chat.workspace_id)
    .where('project_id', '=', chat.project_id)
    .where('chat_id', '=', chat.id)
    .where('id', '=', outputId)
    .forUpdate()
    .executeTakeFirst();
  if (!output) throw new AgentError('output_conflict');
  const proposal = await pendingTarget(db, chat, output);
  if (!proposal) throw new AgentError('output_conflict');
  if (decision === 'keep') {
    await setOutputAction(db, chat, output.id, proposal.action);
    return;
  }
  // A declaration takes the project lock before it checks the revision's Action,
  // so holding it here keeps one from anchoring this document while it moves.
  await acquireProjectLock(db, chat.project_id);
  if (await anchorsDeclaration(db, chat, output.id, proposal.action.id))
    throw new AgentError('output_conflict');
  const target = await unlessInvalidTarget(
    attachOrCreateAction(
      db,
      ownerOf(chat),
      proposal.named.kind,
      proposal.named.target,
      scope.userId,
    ),
  );
  if (!target) throw new AgentError('output_conflict');
  await setOutputAction(db, chat, output.id, target);
  // The Action it left may read as open again; the one it joined, as in progress.
  await refreshActionStatus(db, chat.workspace_id, proposal.action.id);
  await refreshActionStatus(db, chat.workspace_id, target.id);
}

/**
 * The page a document names apart from its Action, while the person has not
 * chosen: a settled document carries its Action's own target.
 */
export function openTargetChoice(
  output: Pick<Output, 'action_id' | 'target_kind' | 'target_label'>,
  action: { target_kind: string; target_label: string } | undefined,
): NamedTarget | null {
  if (!action || !output.action_id || !output.target_label) return null;
  if (!isAgentTargetKind(output.target_kind)) return null;
  if (action.target_kind === output.target_kind && action.target_label === output.target_label)
    return null;
  return { kind: output.target_kind, target: output.target_label };
}

async function pendingTarget(db: Database, chat: Chat, output: Output) {
  if (!output.action_id) return null;
  const action = await outputAction(db, chat, output.action_id);
  const named = openTargetChoice(output, action);
  return named ? { action, named } : null;
}

/** Whether a declaration of the Action names one of this document's revisions. */
async function anchorsDeclaration(db: Database, chat: Chat, outputId: string, actionId: string) {
  const anchored = await db
    .selectFrom('opportunity_implementation_events as e')
    .innerJoin('agent_output_revisions as r', (join) =>
      join
        .onRef('r.id', '=', 'e.output_revision_id')
        .onRef('r.workspace_id', '=', 'e.workspace_id'),
    )
    .select('e.id')
    .where('e.workspace_id', '=', chat.workspace_id)
    .where('e.action_id', '=', actionId)
    .where('r.output_id', '=', outputId)
    .executeTakeFirst();
  return anchored !== undefined;
}

function outputAction(db: Database, chat: Chat, actionId: string) {
  return db
    .selectFrom('actions')
    .select(['id', 'group_key', 'target_kind', 'target_label'])
    .where('workspace_id', '=', chat.workspace_id)
    .where('project_id', '=', chat.project_id)
    .where('id', '=', actionId)
    .executeTakeFirstOrThrow();
}

function setOutputAction(
  db: Database,
  chat: Chat,
  outputId: string,
  action: { id: string; target_kind: string; target_label: string },
) {
  return db
    .updateTable('agent_outputs')
    .set({
      action_id: action.id,
      target_kind: action.target_kind,
      target_label: action.target_label,
    })
    .where('workspace_id', '=', chat.workspace_id)
    .where('project_id', '=', chat.project_id)
    .where('id', '=', outputId)
    .execute();
}

const ownerOf = (chat: Chat) => ({ workspaceId: chat.workspace_id, projectId: chat.project_id });
