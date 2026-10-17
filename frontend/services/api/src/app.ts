/**
 * The TypeScript API service application.
 *
 * Serves liveness, readiness, MCP, every product route family (`routes/`)
 * and, when built, the browser app.
 */
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { sql } from 'kysely';

import type { ServiceConfig } from './config.ts';
import { policy } from './config.ts';
import type { AppEnv } from './context.ts';
import type { Database } from './db/database.ts';
import { ApiError, onError, onNotFound } from './errors.ts';
import { hostGuard } from './http/host-guard.ts';
import { apiNoStore } from './http/no-store.ts';
import { getLogger } from './logging.ts';
import { requestId } from './request-id.ts';
import { PRODUCT_ROUTES } from './routes/index.ts';
import { registerMethodGuards } from './routes/define.ts';
import { streamsOwnBody } from './routes/crawl-logs.ts';
import { registerMcpRoutes } from './mcp/server.ts';
import { ROUTE_CONTRACTS } from './openapi/routes.ts';
import { publicApiDocument } from './public-api/openapi.ts';

const logger = getLogger('api');

async function databaseReachable(db: Database, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('readiness probe timed out')), timeoutMs);
  });
  try {
    // The server-side statement timeout ends the probe's own query at the same
    // bound, so a timed-out probe never keeps its pooled connection busy.
    const probe = db.transaction().execute(async (trx) => {
      await sql`SELECT set_config('statement_timeout', ${String(timeoutMs)}, true)`.execute(trx);
      await sql`SELECT 1`.execute(trx);
    });
    // A probe that loses the race still settles later; observe it so a late
    // rejection is not an unhandled one.
    probe.catch(() => undefined);
    await Promise.race([probe, timeout]);
    return true;
  } catch (error) {
    logger.warning('readiness probe failed', { exception: String(error) });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function createApp(
  config: ServiceConfig,
  db: Database,
  options: { staticDir?: string } = {},
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use(requestId(config.requestIdHeader));
  app.use(apiNoStore());
  app.use(hostGuard(config));
  const ordinaryBodyLimit = bodyLimit({
    maxSize: policy.api.request_body_max_bytes,
    onError: () => {
      throw new ApiError(413, 'Request body too large');
    },
  });
  for (const prefix of ['/api/*', `${policy.api.machine_prefix}/*`])
    app.use(prefix, (c, next) =>
      streamsOwnBody(c.req.method, c.req.path) ? next() : ordinaryBodyLimit(c, next),
    );
  app.onError(onError);
  app.notFound(onNotFound);
  registerMcpRoutes(app, config, db);

  // Liveness: dependency-free and byte-stable, like the backend's /health.
  app.get('/health', (c) => c.json({ status: 'ok' }));

  // Readiness: bounded database reachability; never calls a provider.
  app.get('/ready', async (c) =>
    (await databaseReachable(db, config.readinessTimeoutMs))
      ? c.json({ status: 'ready' })
      : c.json({ status: 'unavailable', database: 'down' }, 503),
  );

  // The public API's own description; anonymous, like any OpenAPI document.
  const publicDocument = publicApiDocument(ROUTE_CONTRACTS);
  app.get(`${policy.api.machine_prefix}/openapi.json`, (c) => c.json(publicDocument));

  registerMethodGuards(app, PRODUCT_ROUTES);
  for (const route of PRODUCT_ROUTES) route.register(app, config, db);

  if (options.staticDir) serveSpa(app, options.staticDir);
  return app;
}

// Paths the API owns; an unmatched one stays a JSON 404, never the SPA shell.
const API_PATHS = /^\/(?:api|v1|mcp|\.well-known|health|ready)(?:\/|$)/u;

/**
 * Self-hosted mode: the built browser app is served from the API's own
 * origin. Files are served as built; any other GET outside the API paths
 * gets `index.html` so client-side routes survive a reload.
 */
function serveSpa(app: Hono<AppEnv>, root: string): void {
  const files = serveStatic({ root });
  const shell = serveStatic({ root, path: 'index.html' });
  app.get('*', async (c, next) => (API_PATHS.test(c.req.path) ? next() : files(c, next)));
  app.get('*', async (c, next) => {
    if (API_PATHS.test(c.req.path)) return next();
    c.header('cache-control', 'no-cache');
    return shell(c, next);
  });
}
