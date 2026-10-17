/**
 * The metering scope every operator-key provider call runs inside. The
 * metering owner opens it; the gateway, the JEV judge and the research and
 * discovery clients refuse a call without it, so a new feature cannot reach a
 * provider unrecorded.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type MeterScope = { workspaceId: string; feature: string };
const scope = new AsyncLocalStorage<MeterScope>();

export class UnmeteredCallError extends Error {
  constructor(provider: string) {
    super(`unmetered_${provider}_call`);
  }
}

/** Throws unless the caller runs inside a metering scope. */
export function assertMetered(provider: string): MeterScope {
  const current = scope.getStore();
  if (!current) throw new UnmeteredCallError(provider);
  return current;
}

/** Runs `call` inside `meter`; only metering owners call this. */
export function runMetered<T>(meter: MeterScope, call: () => Promise<T>): Promise<T> {
  return scope.run(meter, call);
}
