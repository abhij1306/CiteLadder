import { sql } from 'kysely';
import type { z } from 'zod';

import type { Database } from '../db/database.ts';
import { createModelGateway, gatewaySettings, type ModelGateway } from '../models/gateway.ts';
import { ModelError } from '../models/http.ts';

export type ModelCall = {
  provider: string;
  model: string;
  inputHash: string;
  usage: Record<string, unknown> | null;
  latencyMs: number | null;
};

type CallFailure = { outcome: 'invalid_output' } | { outcome: 'model_error'; reason: string };

export function configuredGateway(): ModelGateway | null {
  try {
    return createModelGateway(gatewaySettings());
  } catch (error) {
    if (error instanceof ModelError && error.code === 'not_configured') return null;
    throw error;
  }
}

export async function callStructured<Value, Outcome>(
  gateway: ModelGateway,
  request: {
    system: string;
    user: string;
    schema: z.ZodType<Value>;
    inputHash: string;
    maxAttempts: number;
  },
  accept: (value: Value) => Outcome,
): Promise<{ call: ModelCall; outcome: Outcome | CallFailure }> {
  const call: ModelCall = {
    provider: gateway.adapter,
    model: gateway.model,
    inputHash: request.inputHash,
    usage: null,
    latencyMs: null,
  };
  for (let attempt = 1; attempt <= request.maxAttempts; attempt++) {
    try {
      const { value, result } = await gateway.structured(
        request.system,
        request.user,
        request.schema,
      );
      call.model = result.returned_model;
      call.usage = { ...result.usage, attempts: attempt };
      call.latencyMs = result.latency_ms;
      return { call, outcome: accept(value) };
    } catch (error) {
      if (!(error instanceof ModelError)) throw error;
      call.usage = { attempts: attempt };
      if (error.code !== 'parse')
        return {
          call,
          outcome: {
            outcome: 'model_error',
            reason: error.status ? `http_${error.status}` : error.code,
          },
        };
    }
  }
  return { call, outcome: { outcome: 'invalid_output' } };
}

export async function overCap(
  db: Database,
  table: 'answer_perceptions' | 'fact_verifications',
  input: {
    workspaceId: string;
    auditId: string;
    called: readonly string[];
    perAudit: number;
    perDay: number;
  },
): Promise<boolean> {
  const counted = db
    .selectFrom(table)
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('workspace_id', '=', input.workspaceId)
    .where('outcome', 'in', input.called);
  const [audit, day] = await Promise.all([
    counted.where('audit_id', '=', input.auditId).executeTakeFirstOrThrow(),
    counted
      .where(
        'created_at',
        '>=',
        sql<Date>`date_trunc('day', now() at time zone 'utc') at time zone 'utc'`,
      )
      .executeTakeFirstOrThrow(),
  ]);
  return Number(audit.count) >= input.perAudit || Number(day.count) >= input.perDay;
}

export function outcomeColumns(
  outcome: { outcome: string; reason?: string },
  drops: Record<string, number>,
  call: ModelCall | null,
) {
  return {
    model_provider: call?.provider ?? null,
    model: call?.model ?? null,
    input_hash: call?.inputHash ?? null,
    outcome: outcome.outcome,
    outcome_reason: outcome.reason ?? null,
    drop_counts: JSON.stringify(drops),
    usage: call?.usage ? JSON.stringify(call.usage) : null,
    latency_ms: call?.latencyMs ?? null,
    created_at: new Date(),
  };
}
