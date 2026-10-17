/**
 * The one AI usage recorder. Every provider call outside the Agent's own
 * dispatch runs through `metered`, which opens the metering scope the gateway,
 * the JEV judge and the research clients require, and records the call's
 * tokens and cost in `platform_calls` afterwards. Recording never fails the
 * call, and nothing is charged.
 */
import { randomUUID } from 'node:crypto';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import { getLogger } from '../logging.ts';
import { runMetered } from './meter-scope.ts';
import { gatewayCalls, type ModelGateway } from './gateway.ts';
import { ModelError, type Complete } from './http.ts';
import type { JevClient } from './jev.ts';
import {
  PRICING_REVISION,
  costMicrousd,
  modelPrice,
  tokenCount,
  type MeteredFeature,
  type TokenUsage,
} from './pricing.ts';

const logger = getLogger('api.models.metering');

type MeterContext = { workspaceId: string; feature: MeteredFeature };
type Provider = 'model_gateway' | 'jev' | 'tavily' | 'keenable' | 'dataforseo';
type CallSpec = { provider: Provider; model: string };
export type Outcome<T> = { value: T; usage: TokenUsage | null };

function usageOf(error: unknown): TokenUsage | null {
  return error instanceof ModelError && error.usage ? error.usage : null;
}
function errorCode(error: unknown) {
  if (error instanceof ModelError) return `model_${error.code}`.slice(0, 64);
  if (error instanceof ApiError) return error.code.slice(0, 64);
  return 'call_failed';
}

/** Records a call after it ran; the record never fails the call. */
async function record(
  db: Database,
  context: MeterContext,
  spec: CallSpec,
  usage: TokenUsage | null,
  error: unknown,
) {
  const price = modelPrice(spec.model);
  const now = new Date();
  try {
    await db
      .insertInto('platform_calls')
      .values({
        id: randomUUID(),
        workspace_id: context.workspaceId,
        billing_account_id: null,
        feature: context.feature,
        provider: spec.provider,
        model: spec.model.slice(0, 255),
        charge: 'not_charged',
        status: error ? 'failed' : 'settled',
        pricing_revision: PRICING_REVISION,
        reservation_id: null,
        reserved_credits: 0,
        credits: 0,
        owner_settled: false,
        input_tokens: tokenCount(usage?.input_tokens),
        cached_input_tokens: tokenCount(usage?.cached_input_tokens),
        output_tokens: tokenCount(usage?.output_tokens),
        cost_microusd: price && usage ? costMicrousd(price, usage) : null,
        error_code: error ? errorCode(error) : '',
        created_at: now,
        settled_at: now,
      })
      .execute();
  } catch (error_) {
    logger.warning('models.platform_call_unrecorded', {
      workspace_id: context.workspaceId,
      feature: context.feature,
      exception: error_ instanceof Error ? error_.message : String(error_),
    });
  }
}

/** Runs one provider call under its metering scope and records it. */
async function metered<T>(
  db: Database,
  context: MeterContext,
  spec: CallSpec,
  call: () => Promise<Outcome<T>>,
): Promise<T> {
  let outcome: Outcome<T>;
  try {
    outcome = await runMetered(context, call);
  } catch (error) {
    await record(db, context, spec, usageOf(error), error);
    throw error;
  }
  await record(db, context, spec, outcome.usage, null);
  return outcome.value;
}

/** The gateway with every call metered for `context`; the raw gateway refuses unmetered calls. */
function meteredGateway(db: Database, gateway: ModelGateway, context: MeterContext) {
  const complete: Complete = (system, user, signal, onText, schema) =>
    metered(db, context, { provider: 'model_gateway', model: gateway.model }, async () => {
      const result = await gateway.complete(system, user, signal, onText, schema);
      return { value: result, usage: result.usage };
    });
  return { ...gateway, ...gatewayCalls(complete) };
}

/**
 * A workspace's metering handle, passed to each feature that reaches a
 * provider. Tests that exercise feature logic pass a recording double instead.
 */
export function meterFor(db: Database, workspaceId: string) {
  return {
    gateway: (gateway: ModelGateway, feature: MeteredFeature): ModelGateway =>
      meteredGateway(db, gateway, { workspaceId, feature }),
    call: <T>(feature: MeteredFeature, spec: CallSpec, call: () => Promise<Outcome<T>>) =>
      metered(db, { workspaceId, feature }, spec, call),
    jev: (client: JevClient, feature: MeteredFeature): JevClient => ({
      ...client,
      decide: (state, questions, signal) =>
        metered(
          db,
          { workspaceId, feature },
          { provider: 'jev', model: client.model },
          async () => {
            const result = await client.decide(state, questions, signal);
            return {
              value: result,
              usage: (result.usage ?? null) as TokenUsage | null,
            };
          },
        ),
    }),
  };
}
export type Meter = ReturnType<typeof meterFor>;
