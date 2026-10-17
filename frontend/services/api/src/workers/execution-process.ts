import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/database.ts';
import { getLogger } from '../logging.ts';
import { exclusiveDrain, LaneFailures, runnerOwners, tickAndDrain } from './runner.ts';

/** One runner execution: run due periodic owners, then drain queued work within the budget. */
export async function runExecution() {
  const config = loadConfig();
  const db = createDatabase(config, { execution: true });
  const stop = new AbortController();
  const shutdown = () => stop.abort();
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, shutdown);
  const deadline = performance.now() + config.execution.budgetSeconds * 1000;
  try {
    const options = { signal: stop.signal, deadline };
    const owners = await runnerOwners(db, config);
    const exclusive = exclusiveDrain(config, options);
    let tasks = 0;
    let failure: unknown = null;
    try {
      tasks = await tickAndDrain(owners, options, exclusive);
    } catch (error) {
      failure = error;
      if (error instanceof LaneFailures) tasks = error.tasks;
    }
    const failed = failure instanceof LaneFailures ? failure.lanes : new Set<string>();
    getLogger('workers.runner').info('runner_completed', {
      tasks,
      failed_lanes: [...failed],
      failed: failure !== null,
      stopped: stop.signal.aborted,
      budget_exhausted: performance.now() >= deadline,
    });
    if (failure !== null) throw failure;
  } finally {
    for (const signal of ['SIGTERM', 'SIGINT'] as const) process.removeListener(signal, shutdown);
    await db.destroy();
  }
}
