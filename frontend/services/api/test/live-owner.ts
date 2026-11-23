import { onTestFinished, vi } from 'vitest';
import { changeKinds } from '../src/changes/kinds.ts';
import { testConfig, testDatabase } from './support.ts';

export function singleConnectionDatabase() {
  const narrow = testDatabase(testConfig({ DB_POOL_SIZE: '1', DB_MAX_OVERFLOW: '0' }));
  onTestFinished(() => narrow.destroy());
  return narrow;
}

export function gatedGeneration() {
  const real = changeKinds.generate_prompts.confirm;
  const keys: string[] = [];
  const gate = {
    started: Promise.withResolvers<void>(),
    finish: Promise.withResolvers<void>(),
  };
  const owner = vi
    .spyOn(changeKinds.generate_prompts, 'confirm')
    .mockImplementation(async (trx, settings, actor, change, stored) => {
      keys.push(change.id);
      gate.started.resolve();
      await gate.finish.promise;
      return real(trx, settings, actor, change, stored);
    });
  onTestFinished(() => owner.mockRestore());
  return {
    keys,
    gate,
    next() {
      gate.started = Promise.withResolvers<void>();
      gate.finish = Promise.withResolvers<void>();
    },
  };
}
