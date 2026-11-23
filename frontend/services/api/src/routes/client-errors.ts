/**
 * The browser's error sink: one structured log line per report, on the
 * service's own log stream. Nothing is stored and nothing leaves the service.
 * Who reported comes from the request's acting user, never from the body.
 */
import { CSP_REPORTS_PATH } from '@citeladder/contracts/route-ownership';
import {
  clientReportSchema,
  cspReportBatchSchema,
  withoutQueryStrings,
  type ClientReport,
} from '@citeladder/contracts/client-errors';
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
  const user: SessionUser | undefined = c.get('user');
  return { user_id: user?.id ?? null, workspace_id: seen.workspaceId };
}

async function admit(
  c: Context<AppEnv>,
  { config, db }: { config: ServiceConfig; db: Database },
  { maxBytes, budgetName }: { maxBytes: number; budgetName: 'client_error_report' | 'csp_report' },
) {
  const raw = await c.req.text();
  if (Buffer.byteLength(raw) > maxBytes) throw new ApiError(413, 'Request body too large');
  const who = await reporter(c, config, db);
  // Every browser of a self-hosted install acts as a user, so the budget is per user.
  await spendBudget(db, budget(budgetName, config.settings), who.user_id ?? 'anonymous');
  return who;
}

function logLine(report: ClientReport) {
  switch (report.kind) {
    case 'slow_interaction':
      return {
        event: 'client.slow_interaction',
        level: 'info' as const,
        fields: {
          ...report,
          scripts: report.scripts.map((script) => ({
            ...script,
            source: withoutQueryStrings(script.source),
            invoker: withoutQueryStrings(script.invoker),
          })),
        },
      };
    case 'chunk_load':
    case 'render':
    case 'route':
    case 'unhandled':
      return {
        event: 'client.error',
        level: report.kind === 'chunk_load' ? ('warning' as const) : ('error' as const),
        fields: {
          kind: report.kind,
          message: withoutQueryStrings(report.message),
          stack: report.stack === null ? null : withoutQueryStrings(report.stack),
          route: report.route,
          release: report.release,
          component: report.component ?? null,
        },
      };
    default: {
      const unreachable: never = report;
      return unreachable;
    }
  }
}

function logged(url: string | null | undefined): string | null {
  return url ? withoutQueryStrings(url) : null;
}

export const clientErrorRoutes = [
  definePostRoute({
    family: 'client-errors',
    authorize: 'public',
    path: '/api/v1/client-errors',
    params: { path: {}, query: {} },
    body: clientReportSchema,
    response: z.null(),
    raw: true,
    status: 204,
    async handle({ c, db, config }) {
      const who = await admit(
        c,
        { config, db },
        { maxBytes: clientErrors.max_body_bytes, budgetName: 'client_error_report' },
      );
      const report = await readBody(c, clientReportSchema);
      const line = logLine(report);
      getLogger(clientErrors.logger)[line.level](line.event, { ...line.fields, ...who });
      return c.body(null, 204);
    },
  }),
  definePostRoute({
    family: 'client-errors',
    authorize: 'public',
    path: CSP_REPORTS_PATH,
    params: { path: {}, query: {} },
    body: cspReportBatchSchema,
    response: z.null(),
    raw: true,
    status: 204,
    async handle({ c, db, config }) {
      await admit(
        c,
        { config, db },
        { maxBytes: clientErrors.max_csp_body_bytes, budgetName: 'csp_report' },
      );
      const reports = await readBody(c, cspReportBatchSchema, 'application/reports+json');
      const logger = getLogger(clientErrors.logger);
      for (const report of reports) {
        if (!('body' in report)) continue;
        const { body } = report;
        logger.warning('client.csp_violation', {
          directive: body.effectiveDirective,
          disposition: body.disposition,
          document: logged(body.documentURL),
          blocked: logged(body.blockedURL),
          source: logged(body.sourceFile),
          line: body.lineNumber ?? null,
          column: body.columnNumber ?? null,
          sink: body.sample ?? null,
        });
      }
      return c.body(null, 204);
    },
  }),
];
