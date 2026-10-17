import { ensureLocalAccount } from '../auth/local.ts';
import { createDatabase } from '../db/database.ts';
import { loadConfig } from '../config.ts';
import { operatorMain } from './operator.ts';

await operatorMain(async () => {
  if (process.argv.includes('--help')) {
    console.log(
      'bootstrap:account. Creates the local user and its workspace, after the schema baseline (migrate). Idempotent.',
    );
    return;
  }
  const config = loadConfig();
  const db = createDatabase(config);
  try {
    console.log(JSON.stringify(await ensureLocalAccount(db)));
  } finally {
    await db.destroy();
  }
});
