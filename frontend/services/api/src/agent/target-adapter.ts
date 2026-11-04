import { attachOrCreateAction, ActionTargetError } from '../opportunities/actions.ts';
import type { AttachTarget } from './outputs.ts';

/**
 * Invalid suggested targets preserve the deliverable for explicit retargeting.
 * Each document attaches once: one created in an Action's chat already carries
 * that Action, and a chat without one takes the first document's Action.
 */
export const attachAgentTarget: AttachTarget = async (db, chat, output, payload, userId) => {
  if (output.action_id || !payload.target_kind || !payload.target?.trim()) return;
  let action;
  try {
    action = await attachOrCreateAction(
      db,
      { workspaceId: chat.workspace_id, projectId: chat.project_id },
      payload.target_kind,
      payload.target,
      userId,
    );
  } catch (error) {
    if (error instanceof ActionTargetError) return;
    throw error;
  }
  await db
    .updateTable('agent_chats')
    .set({ action_id: action.id })
    .where('workspace_id', '=', chat.workspace_id)
    .where('project_id', '=', chat.project_id)
    .where('id', '=', chat.id)
    .where('action_id', 'is', null)
    .execute();
  await db
    .updateTable('agent_outputs')
    .set({
      action_id: action.id,
      target_kind: action.target_kind,
      target_label: action.target_label,
    })
    .where('workspace_id', '=', chat.workspace_id)
    .where('project_id', '=', chat.project_id)
    .where('id', '=', output.id)
    .execute();
};
