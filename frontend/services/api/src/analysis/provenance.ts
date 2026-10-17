/**
 * Frozen retrieval and route provenance, for one execution or one run.
 *
 * The task's request snapshot wins, then its
 * route snapshot, then the audit's frozen measurement policy. Live
 * configuration is never consulted.
 */
import { policy } from '../config.ts';
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

/** The retrieval state frozen in an audit's measurement-policy block. */
export function auditFrozenRetrievalEnabled(configuration: unknown): boolean | null {
  const frozen = (isObject(configuration) ? configuration : {})[
    policy.visibility.measurement_policy_key
  ];
  return isObject(frozen) ? frozenRetrievalEnabled(frozen) : null;
}

export function executionFrozenProvenance(input: {
  requestSnapshot: unknown;
  routeSnapshot: unknown;
  auditConfiguration: unknown;
}): boolean | null {
  const retrieval = frozenRetrievalEnabled(input.requestSnapshot, input.routeSnapshot);
  return retrieval ?? auditFrozenRetrievalEnabled(input.auditConfiguration);
}

/** One measured route on an aggregate surface. */
export type ModelProvenance = {
  logical_engine: string;
  transport_provider: string;
  transport_model: string;
  retrieval_enabled: boolean | null;
};

// Catalog order is the sorted engine catalog; unknown engines sort after it.
const ENGINE_ORDER = new Map(
  policy.visibility.logical_engines.toSorted(compareText).map((engine, index) => [engine, index]),
);

function engineRank(engine: string): number {
  return ENGINE_ORDER.get(engine) ?? ENGINE_ORDER.size;
}

// Unrecorded first, then off, then on.
const RETRIEVAL_RANK = new Map<boolean | null, number>([
  [null, 0],
  [false, 1],
  [true, 2],
]);

function retrievalRank(value: boolean | null): number {
  return RETRIEVAL_RANK.get(value)!;
}

/** Exact duplicates removed, in stable catalog order. */
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
      retrievalRank(left.retrieval_enabled) - retrievalRank(right.retrieval_enabled),
  );
}

/** A run's routes from its frozen engine snapshots, with its frozen retrieval state. */
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
