import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { localEnvironment } from './local-environment.ts';
import { OperatorRefusal, operatorMain } from './operator.ts';
import { resetSequence, type Execute } from './reset-sequence.ts';

const run = promisify(execFile);

/** Each step prints its own reviewed diagnostic; execFile would otherwise swallow it. */
const execute: Execute = async (command, args, options) => {
  try {
    return await run(command, args, options);
  } catch (error) {
    if (error && typeof error === 'object' && 'stderr' in error)
      process.stderr.write(String(error.stderr));
    throw new OperatorRefusal('reset_step_failed');
  }
};

await operatorMain(async () => {
  await resetSequence(localEnvironment(), execute);
  console.log('Database reset: schema migrations applied and the local workspace recreated.');
});
