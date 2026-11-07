import { serve } from '@hono/node-server';

import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDatabase } from './db/database.ts';
import { interactiveSlots } from './http/interactive-slots.ts';
import { getLogger } from './logging.ts';

const logger = getLogger('api');
const config = loadConfig();
const db = createDatabase(config);
const server = serve(
  {
    fetch: createApp(config, db, { staticDir: process.env.STATIC_DIR?.trim() || undefined }).fetch,
    hostname: config.host,
    port: config.port,
  },
  (info) => logger.info('api_service_started', { host: config.host, port: info.port }),
);

/**
 * Open event streams would hold `close` until the platform kills the process,
 * so in-request work is stopped first: open turns settle as interrupted and
 * interactive audits leave their remaining phases to the runner.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info('api_service_stopping', { signal });
  const settled = await interactiveSlots.drain();
  if (!settled) logger.warning('api_service_interactive_work_unsettled', { signal });
  server.close(() => {
    db.destroy()
      .catch((error: unknown) => logger.exception('api_service_pool_close_failed', error))
      .finally(() => process.exit(0));
  });
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
