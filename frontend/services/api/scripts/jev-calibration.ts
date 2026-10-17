import { parseArgs } from 'node:util';

import { loadConfig } from '../src/config.ts';
import { createDatabase } from '../src/db/database.ts';
import { loadCalibration } from '../src/prompts/calibration.ts';

const { values } = parseArgs({ options: { actor: { type: 'string' }, since: { type: 'string' } } });
if (!values.actor) throw new Error('--actor must identify a persisted active admin');
const since = values.since ? new Date(values.since) : undefined;
if (since && !Number.isFinite(since.getTime())) throw new Error('--since must be an ISO date');
const db = createDatabase(loadConfig());
try {
  process.stdout.write(
    `${JSON.stringify(await loadCalibration(db, values.actor, since), null, 2)}\n`,
  );
} finally {
  await db.destroy();
}
