import { loadConfig, policy, resolveSettingSpec } from '../config.ts';
import { createDatabase } from '../db/database.ts';
import { seedAudit } from '../audits/seed.ts';

const config = loadConfig();
if (config.appEnv !== 'development' && config.appEnv !== 'test')
  throw new Error('Development seeding requires development or test mode');
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const request: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const db = createDatabase(config);
try {
  const id = await seedAudit(
    db,
    request,
    String(resolveSettingSpec(policy.settings.encryption_key)),
    process.env,
  );
  process.stdout.write(`${JSON.stringify({ audit_id: id })}\n`);
} finally {
  await db.destroy();
}
