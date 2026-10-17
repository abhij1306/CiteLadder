import { serve } from '@hono/node-server';

import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDatabase } from './db/database.ts';
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

function shutdown(signal: string): void {
  logger.info('api_service_stopping', { signal });
  server.close(() => {
    db.destroy()
      .catch((error: unknown) => logger.exception('api_service_pool_close_failed', error))
      .finally(() => process.exit(0));
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
