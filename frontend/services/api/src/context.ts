import type { Actor } from './auth/actor.ts';
import type { SessionUser } from './auth/session.ts';
import type { WorkspaceContext } from './auth/workspace.ts';
import type { Permission } from './commands/permission.ts';

export type AppEnv = {
  Variables: {
    requestId: string;
    user: SessionUser;
    workspace: WorkspaceContext;
    /** The command permission the route's gate checked, when it serves a command. */
    permission?: Permission;
    actor?: Actor;
    apiKey?: { id: string; projectIds: readonly string[] | null };
  };
};
