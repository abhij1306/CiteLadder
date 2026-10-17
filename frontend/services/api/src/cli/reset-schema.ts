import pg from 'pg';

import { localEnvironment } from './local-environment.ts';
import { operatorMain } from './operator.ts';
import { resetTarget } from './reset-sequence.ts';
import { applyMigrations, baselineClient, describeMigrations } from './schema-baseline.ts';

/** Drop and recreate one authorized database, then apply the schema migrations. */
await operatorMain(async () => {
  const env = localEnvironment();
  const target = resetTarget(env);
  const quoted = `"${target.database.replaceAll('"', '""')}"`;
  const admin = new pg.Client({
    connectionString: target.adminUrl,
    connectionTimeoutMillis: 30000,
  });
  await admin.connect();
  try {
    console.log(`Dropping and recreating database '${target.database}'...`);
    await admin.query(`DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${quoted}`);
  } finally {
    await admin.end();
  }
  const schema = baselineClient(target.databaseUrl, env);
  await schema.connect();
  try {
    console.log(describeMigrations(await applyMigrations(schema)));
  } finally {
    await schema.end();
  }
});
