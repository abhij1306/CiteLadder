/** Local dev seeder bridge; reuse the crawl owner without exposing an HTTP writer. */
import { loadConfig } from '../src/config.ts';
import { createDatabase } from '../src/db/database.ts';
import { seedCrawl, seedSelection } from '../src/site-health/seed.ts';
import { z } from 'zod';

const config = loadConfig();
const target = new URL(config.databaseUrl);
if (
  config.appEnv !== 'development' ||
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
)
  throw new Error('Site Health seed admission requires a local development database');
let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += String(chunk);
const input = z
  .discriminatedUnion('operation', [
    z.strictObject({
      operation: z.literal('create'),
      workspace_id: z.uuid(),
      project_id: z.uuid(),
      seed: z.string(),
    }),
    z.strictObject({
      operation: z.literal('select'),
      workspace_id: z.uuid(),
      project_id: z.uuid(),
      crawl_id: z.uuid(),
    }),
  ])
  .parse(JSON.parse(raw));
const db = createDatabase(config);
try {
  const id =
    input.operation === 'create'
      ? await seedCrawl(db, input.workspace_id, input.project_id, input.seed)
      : await seedSelection(db, input.workspace_id, input.project_id, input.crawl_id);
  process.stdout.write(`${JSON.stringify({ id })}\n`);
} finally {
  await db.destroy();
}
