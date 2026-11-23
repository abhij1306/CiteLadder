import { agentChatDetailSchema } from '@citeladder/contracts/agent';
import { agentPolicy } from '../agent/contracts.ts';
import { decideProposal } from '../agent/proposal-outcomes.ts';
import { readChat } from '../agent/reads.ts';
import { definePostRoute } from './define.ts';

const proposalPath = {
  chat_id: { scalar: { kind: 'uuid' }, required: true },
  message_id: { scalar: { kind: 'uuid' }, required: true },
  index: {
    scalar: { kind: 'int', ge: 0, le: agentPolicy.max_proposals_per_turn - 1 },
    required: true,
  },
} as const;

function decisionRoute(decision: 'confirm' | 'dismiss') {
  return definePostRoute({
    family: 'agent',
    path: `/api/v1/agent/chats/{chat_id}/messages/{message_id}/proposals/{index}/${decision}`,
    capability: 'run',
    params: { path: proposalPath, query: {} },
    response: agentChatDetailSchema,
    async handle({ db, config, c }, { path }) {
      const workspaceId = c.get('workspace').workspaceId;
      await decideProposal(db, config, {
        scope: { workspaceId, userId: c.get('user').id },
        ref: { chatId: path.chat_id, messageId: path.message_id, index: path.index },
        decision,
      });
      return readChat(db, { workspaceId }, path.chat_id);
    },
  });
}

export const agentProposalRoutes = [decisionRoute('confirm'), decisionRoute('dismiss')];
