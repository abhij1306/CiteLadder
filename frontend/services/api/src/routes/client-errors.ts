/**
 * The browser's error sink: one structured log line per report, on the
 * service's own log stream. Nothing is stored and nothing leaves the service.
 * Who reported comes from the request's acting user, never from the body.
 */
import { clientErrorReportSchema, withoutQueryStrings } from '@citeladder/contracts/client-errors';
import type { Context } from 'hono';
import { z } from 'zod';

import { budget, spendBudget } from '../abuse/usage.ts';
import { sessionUser, type SessionUser } from '../auth/session.ts';
import { activeWorkspaceMembership } from '../auth/workspace.ts';
import { clientErrors } from '../config/client-errors.ts';
import type { ServiceConfig } from '../config.ts';
import type { AppEnv } from '../context.ts';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import { readBody } from '../http/body.ts';
import { getLogger } from '../logging.ts';
import { definePostRoute } from './define.ts';

/**
 * The reporting user and, when the request names one in `X-Workspace-Id`,
 * that workspace once the session's membership resolution accepts it. A
 * request naming none records none: it never falls back to the user's
 * earliest workspace. A signed-out or stale session, or a workspace the user
 * is not a member of, reports with whatever was proved: the user alone, or
 * nobody.
 */
async function reporter(c: Context<AppEnv>, config: ServiceConfig, db: Database) {
  const seen: { workspaceId: string | null } = { workspaceId: null };
  const named = c.req.header('x-workspace-id') !== undefined;
  try {
    await sessionUser(
      config,
      db,
      named ? activeWorkspaceMembership() : undefined,
    )(c, () => {
      if (!named) return Promise.resolve();
      seen.workspaceId = c.get('workspace').workspaceId;
      return Promise.resolve();
    });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status >= 500) throw error;
  }
  // Set only when the session proved a user, whether or not membership followed.
  const user: SessionUser | undefined = c.get('user');
  return { user_id: user?.id ?? null, workspace_id: seen.workspaceId };
}

export const clientErrorRoutes = [
  definePostRoute({
    family: 'client-errors',
    authorize: 'public',
    path: '/api/v1/client-errors',
    params: { path: {}, query: {} },
    body: clientErrorReportSchema,
    response: z.null(),
    raw: true,
    status: 204,
    async handle({ c, db, config }) {
      const raw = await c.req.text();
      if (Buffer.byteLength(raw) > clientErrors.max_body_bytes)
        throw new ApiError(413, 'Request body too large');
      const who = await reporter(c, config, db);
      // Every browser of a self-hosted install acts as a user, so the budget is per user.
      await spendBudget(
        db,
        budget('client_error_report', config.settings),
        who.user_id ?? 'anonymous',
      );
      const report = await readBody(c, clientErrorReportSchema);
      const fields = {
        kind: report.kind,
        message: withoutQueryStrings(report.message),
        stack: report.stack === null ? null : withoutQueryStrings(report.stack),
        route: report.route,
        release: report.release,
        component: report.component ?? null,
        ...who,
      };
      // A missing chunk is the expected cost of a deploy; the rest are defects.
      const logger = getLogger(clientErrors.logger);
      if (report.kind === 'chunk_load') logger.warning('client.error', fields);
      else logger.error('client.error', fields);
      return c.body(null, 204);
    },
  }),
];
