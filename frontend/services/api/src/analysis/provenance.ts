import { auditFrozenRetrievalEnabled } from '../audits/frozen-configuration.ts';
import { logicalEngines } from '../config/providers.ts';
import { compareText } from '../text-order.ts';

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function frozenRetrievalEnabled(...snapshots: unknown[]): boolean | null {
  for (const snapshot of snapshots) {
    if (!isObject(snapshot)) continue;
    const retrievalEnabled = snapshot.retrieval_enabled;
    if (typeof retrievalEnabled === 'boolean') {
      return retrievalEnabled;
    }
  }
  return null;
}

export function executionFrozenProvenance(input: {
  requestSnapshot: unknown;
  routeSnapshot: unknown;
  auditConfiguration: unknown;
}): boolean {
  const retrieval = frozenRetrievalEnabled(input.requestSnapshot, input.routeSnapshot);
  return retrieval ?? auditFrozenRetrievalEnabled(input.auditConfiguration);
}

export type ModelProvenance = {
  logical_engine: string;
  transport_provider: string;
  transport_model: string;
  retrieval_enabled: boolean;
};

const ENGINE_ORDER = new Map<string, number>(
  logicalEngines.toSorted(compareText).map((engine, index) => [engine, index]),
);

function engineRank(engine: string): number {
  return ENGINE_ORDER.get(engine) ?? ENGINE_ORDER.size;
}

export function buildModelProvenance(items: Iterable<ModelProvenance>): ModelProvenance[] {
  const unique = new Map<string, ModelProvenance>();
  for (const item of items) {
    const key = JSON.stringify([
      item.logical_engine,
      item.transport_provider,
      item.transport_model,
      item.retrieval_enabled,
    ]);
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].sort(
    (left, right) =>
      engineRank(left.logical_engine) - engineRank(right.logical_engine) ||
      compareText(left.logical_engine, right.logical_engine) ||
      compareText(left.transport_provider, right.transport_provider) ||
      compareText(left.transport_model, right.transport_model) ||
      Number(left.retrieval_enabled) - Number(right.retrieval_enabled),
  );
}

export function modelProvenanceFor(
  engineSnapshots: readonly {
    logical_engine: string;
    transport_provider: string;
    transport_model: string;
  }[],
  configuration: unknown,
): ModelProvenance[] {
  const retrieval = auditFrozenRetrievalEnabled(configuration);
  return buildModelProvenance(
    engineSnapshots.map((snapshot) => ({
      logical_engine: snapshot.logical_engine,
      transport_provider: snapshot.transport_provider,
      transport_model: snapshot.transport_model,
      retrieval_enabled: retrieval,
    })),
  );
}
