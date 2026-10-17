import type { Actor } from './auth/actor.ts';
import type { SessionUser } from './auth/session.ts';
import type { WorkspaceContext } from './auth/workspace.ts';

/** Hono context variables every route and middleware can rely on. */
export type AppEnv = {
  Variables: {
    requestId: string;
    user: SessionUser;
    workspace: WorkspaceContext;
    /** Set only for a public API request: the key acting for its creator. */
    actor?: Actor;
    /** The authenticated key of a public API request and its project allowlist. */
    apiKey?: { id: string; projectIds: readonly string[] | null };
  };
};
