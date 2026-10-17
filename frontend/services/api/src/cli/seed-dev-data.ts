import { loadConfig, policy, resolveSettingSpec } from '../config.ts';
import { createDatabase } from '../db/database.ts';
import { localEnvironment } from './local-environment.ts';
import { operatorMain, requireLocalDevelopment } from './operator.ts';
import { seedStatic } from './seed-static.ts';
import { seedProjectAudit, seedSiteHealth, seedOpportunityRefresh } from './seed-runs.ts';
import { seedIntegrations } from './seed-integrations.ts';

await operatorMain(async () => {
  if (process.argv.includes('--help')) {
    console.log('seed:dev [--static-only]. Local development database; recorded transports only.');
    return;
  }
  const env = localEnvironment();
  // Clear inherited credentials before constructing any intelligence or worker owner.
  for (const name of Object.keys(env))
    if (/(?:_API_KEY|_CLIENT_SECRET|_CLIENT_ID)$/iu.test(name) || /^DEFAULT_AGENT_/iu.test(name)) {
      delete env[name];
      delete process.env[name];
    }
  const config = loadConfig(env);
  requireLocalDevelopment(config);
  const encryptionKey = String(resolveSettingSpec(policy.settings.encryption_key, env));
  const db = createDatabase(config);
  try {
    const seeded = await seedStatic(db, config, encryptionKey);
    if (!process.argv.includes('--static-only')) {
      await seedIntegrations(db, seeded.primary, encryptionKey);
      await seedProjectAudit(db, seeded.primary, encryptionKey);
      await seedProjectAudit(db, seeded.secondary, encryptionKey, 0, ['gemini']);
      const crawlId = await seedSiteHealth(db, seeded.primary);
      await seedOpportunityRefresh(db, seeded.primary, 'site_crawl', crawlId);
      for (const generation of [1, 2]) {
        const auditId = await seedProjectAudit(db, seeded.primary, encryptionKey, generation);
        await seedOpportunityRefresh(db, seeded.primary, 'audit', auditId);
      }
    }
    console.log(JSON.stringify(seeded));
  } finally {
    await db.destroy();
  }
});
