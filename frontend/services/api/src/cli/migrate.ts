import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';

import type pg from 'pg';

import { OperatorRefusal, operatorDiagnostic } from './operator.ts';
import { applyMigrations, baselineClient, describeMigrations } from './schema-baseline.ts';

/** A fresh or replaced database VM may still be starting; retry the connection until the deadline. */
async function connect(databaseUrl: string, deadline: number): Promise<pg.Client> {
  const client = baselineClient(databaseUrl);
  try {
    await client.connect();
    return client;
  } catch (error) {
    await client.end().catch(() => undefined);
    if (Date.now() >= deadline) throw error;
    await sleep(5000);
    return connect(databaseUrl, deadline);
  }
}

/** The migrate step: apply pending schema migrations, then exit. */
async function main() {
  const { values } = parseArgs({ options: { 'wait-seconds': { type: 'string', default: '0' } } });
  const waitSeconds = Number(values['wait-seconds']);
  if (!Number.isFinite(waitSeconds) || waitSeconds < 0)
    throw new OperatorRefusal('--wait-seconds must be a non-negative number.');
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new OperatorRefusal('DATABASE_URL is required.');
  const client = await connect(databaseUrl, Date.now() + waitSeconds * 1000);
  try {
    console.log(describeMigrations(await applyMigrations(client)));
  } finally {
    await client.end();
  }
}

try {
  await main();
} catch (error) {
  // The shared operator redaction already names a failed statement's SQLSTATE.
  console.error(operatorDiagnostic(error));
  process.exitCode = 1;
}
