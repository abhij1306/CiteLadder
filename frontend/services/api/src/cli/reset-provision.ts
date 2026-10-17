import { createDatabase } from '../db/database.ts';
import { ensureLocalAccount } from '../auth/local.ts';
import { loadConfig } from '../config.ts';
import { localEnvironment } from './local-environment.ts';
import { operatorMain } from './operator.ts';

/** After a reset, recreate the local user and its workspace. */
await operatorMain(async () => {
  const db = createDatabase(loadConfig(localEnvironment()));
  try {
    await ensureLocalAccount(db);
  } finally {
    await db.destroy();
  }
});
