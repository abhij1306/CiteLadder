'use client';

import { useWorkspaceCapability } from '@/lib/project/project-context';

/**
 * Whether this member can send to the Agent, and why not when they cannot.
 * The server re-checks role on every turn; this only decides what the
 * composer offers and explains.
 */
export type AgentAccess = { canSend: true } | { canSend: false; reason: 'role'; message: string };

export function useAgentAccess(): AgentAccess {
  const mayRun = useWorkspaceCapability('run');
  if (!mayRun)
    return {
      canSend: false,
      reason: 'role',
      message: 'Your workspace role can read chats but not ask the agent.',
    };
  return { canSend: true };
}
