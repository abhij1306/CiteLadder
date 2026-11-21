import type { Meter } from '../src/models/metering.ts';
import type { ModelGateway } from '../src/models/gateway.ts';
import type { JevClient } from '../src/models/jev.ts';
import { runMetered } from '../src/models/meter-scope.ts';

export function recordingMeter(workspaceId = 'test-workspace') {
  const features: string[] = [];
  const scoped =
    <A extends unknown[], R>(feature: string, call: (...args: A) => Promise<R>) =>
    (...args: A) => {
      features.push(feature);
      return runMetered({ workspaceId, feature }, () => call(...args));
    };
  const meter: Meter = {
    gateway: (gateway: ModelGateway, feature) => ({
      ...gateway,
      complete: scoped(feature, gateway.complete),
      completeStructured: scoped(feature, gateway.completeStructured),
      structured: scoped(feature, gateway.structured) as ModelGateway['structured'],
    }),
    jev: (client: JevClient, feature) => ({ ...client, decide: scoped(feature, client.decide) }),
    call: <T>(
      feature: Parameters<Meter['call']>[0],
      _spec: unknown,
      call: () => Promise<{ value: T }>,
    ) => scoped(feature, async () => (await call()).value)(),
  };
  return { meter, features };
}
