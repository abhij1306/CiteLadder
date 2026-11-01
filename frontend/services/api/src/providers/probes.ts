import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../db/database.ts';
import { createSecretCipher } from '../integrations/fernet.ts';
import { providerErrorCode } from '../models/http.ts';
import {
  approvedEndpoint,
  basicAuthorization,
  type Connection,
  getConnection,
  requireActiveTransport,
  tenantConnections,
} from './connections.ts';
import { openaiReasoning, providerPolicy, type Engine, type ProviderSettings } from './config.ts';
import {
  ProbeError,
  sendProbe,
  type ProbeRequest,
  type ProbeTransport,
} from './probe-transport.ts';
import { isNonEmpty, lastOf } from '../lists.ts';

const object = z.record(z.string(), z.unknown());
function probeSecret(encrypted: string, key: string) {
  try {
    return createSecretCipher(key).decrypt(encrypted);
  } catch {
    throw new ProbeError('auth_failure');
  }
}
const textBlock = z.object({ type: z.string(), text: z.string().optional() });
function requireAnswer(transport: string, body: unknown): string | undefined {
  const parsed = object.parse(body);
  if (['failed', 'cancelled', 'incomplete'].includes(String(parsed.status)))
    throw new ProbeError('parse_error');
  let blocks: z.infer<typeof textBlock>[];
  if (transport === 'openai') {
    blocks = z
      .array(z.object({ content: z.array(textBlock).optional() }))
      .parse(parsed.output)
      .flatMap((item) => item.content ?? []);
  } else if (transport === 'google') {
    blocks = z
      .array(z.object({ type: z.string(), content: z.array(textBlock).optional() }))
      .parse(parsed.steps)
      .filter((step) => step.type === 'model_output')
      .flatMap((step) => step.content ?? []);
  } else blocks = z.array(textBlock).parse(parsed.content);
  if (!blocks.some((block) => typeof block.text === 'string' && block.text.trim()))
    throw new ProbeError('parse_error');
  return typeof parsed.model === 'string' ? parsed.model : undefined;
}
type ProbeItem = {
  engine: string;
  model: string;
  transport: string;
};
type ProbeOutcome = { status: 'ok' | 'failed'; errorCode: string; model: string };

/** One bounded probe request against the connection's route; returns the model that answered. */
async function attemptProbe(o: {
  connection: Connection;
  item: ProbeItem;
  engine: Engine;
  encryptionKey: string;
  settings: ProviderSettings;
  send: ProbeTransport;
}) {
  const { connection, item, engine, encryptionKey, settings, send } = o;
  const transport = connection.transport_provider;
  let model = item.model;
  const secret = probeSecret(connection.api_key_encrypted, encryptionKey);
  const request = probeRequest(connection.base_url, transport, model, secret, settings, engine);
  const response = await send(request);
  if (response.status < 200 || response.status >= 300)
    throw new ProbeError(providerErrorCode(response.status));
  if (transport === 'dataforseo') {
    if (object.parse(response.body).status_code !== providerPolicy.dataforseo.success_status)
      throw new ProbeError('auth_failure');
  } else model = requireAnswer(transport, response.body) ?? model;
  return model;
}

/** Persists one probe result unless the connection or route changed while it ran. */
function recordProbe(
  db: Database,
  workspaceId: string,
  connection: Connection,
  item: ProbeItem,
  outcome: ProbeOutcome,
  timing: { latency: number; testedAt: Date },
) {
  const id = connection.id;
  const { latency, testedAt } = timing;
  const model = outcome.model;
  let { status, errorCode } = outcome;
  return db.transaction().execute(async (trx) => {
    const current = await tenantConnections(trx, workspaceId)
      .where('c.id', '=', id)
      .forUpdate('c')
      .executeTakeFirst();
    const matches =
      current?.credential_revision === connection.credential_revision &&
      current?.base_url === connection.base_url;
    if (!matches) {
      status = 'failed';
      errorCode = 'revision_changed';
    }
    const detail =
      status === 'ok'
        ? providerPolicy.probe_success_detail
        : `Connection test failed: ${errorCode}`;
    if (current) {
      await trx
        .insertInto('provider_connection_tests')
        .values({
          id: randomUUID(),
          workspace_id: workspaceId,
          connection_id: id,
          status,
          error_code: errorCode,
          detail,
          latency_ms: latency,
          logical_engine: item.engine,
          transport_provider: item.transport,
          transport_model: model,
          created_at: testedAt,
        })
        .execute();
      if (matches) {
        await trx
          .updateTable('provider_connections')
          .set({ last_test_status: status, last_tested_at: testedAt, updated_at: testedAt })
          .where('id', '=', id)
          .execute();
      }
    }
    return {
      connection_id: id,
      status,
      error_code: errorCode,
      detail,
      latency_ms: latency,
      logical_engine: item.engine,
      transport_provider: item.transport,
      transport_model: model,
      tested_at: testedAt.toISOString(),
    };
  });
}
export async function probeConnection(
  db: Database,
  workspaceId: string,
  id: string,
  encryptionKey: string,
  settings: ProviderSettings,
  send: ProbeTransport = sendProbe,
) {
  const connection = await getConnection(db, workspaceId, id);
  requireActiveTransport(connection);
  const routes = await db
    .selectFrom('provider_routes')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('connection_id', '=', id)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const transport = connection.transport_provider;
  const defaultEngine = Object.entries(providerPolicy.routes).find(
    ([, route]) => route.transport_provider === transport,
  )![0];
  const engine = (routes[0]?.logical_engine ?? defaultEngine) as Engine;
  const catalog = providerPolicy.routes[engine];
  const work: ProbeItem[] = [{ engine, model: catalog.transport_model, transport }];
  const results = [];
  for (const item of work) {
    const started = performance.now();
    let status: 'ok' | 'failed' = 'ok';
    let errorCode = '';
    let model = item.model;
    try {
      model = await attemptProbe({
        connection,
        item,
        engine,
        encryptionKey,
        settings,
        send,
      });
    } catch (error) {
      status = 'failed';
      errorCode = error instanceof ProbeError ? error.code : 'parse_error';
    }
    const testedAt = new Date();
    const latency = Math.round(performance.now() - started);
    const outcome = { status, errorCode, model };
    const result = await recordProbe(db, workspaceId, connection, item, outcome, {
      latency,
      testedAt,
    });
    results.push(result);
  }
  if (!isNonEmpty(results)) throw new Error('Expected at least one probe result');
  return results.find((result) => result.status === 'failed') ?? lastOf(results);
}
function probeRequest(
  baseUrl: string,
  transport: string,
  model: string,
  secret: string,
  settings: ProviderSettings,
  engine: Engine,
): ProbeRequest {
  const common = {
    timeoutSeconds: settings.timeoutSeconds,
    maxBytes: providerPolicy.probe_max_response_bytes,
  };
  const url = approvedEndpoint(transport, baseUrl, settings);
  const prompt = providerPolicy.probe_prompt;
  const cap = settings.outputTokens;
  const route = providerPolicy.routes[engine];
  const effort = route.reasoning_effort;
  if (transport === 'dataforseo') {
    const pair = z
      .object({ login: z.string().min(1), password: z.string().min(1) })
      .parse(JSON.parse(secret));
    return {
      ...common,
      timeoutSeconds: settings.dataforseoTimeout,
      url: `${url}${providerPolicy.dataforseo.probe_path}`,
      headers: {
        authorization: basicAuthorization(pair),
      },
    };
  }
  if (transport === 'openai')
    return {
      ...common,
      url,
      headers: { authorization: `Bearer ${secret}` },
      body: {
        model,
        input: prompt,
        store: false,
        max_output_tokens: cap,
        ...openaiReasoning(effort),
      },
    };
  if (transport === 'google')
    return {
      ...common,
      url,
      headers: { 'x-goog-api-key': secret },
      body: {
        model,
        input: prompt,
        system_instruction: '',
        store: false,
        max_output_tokens: cap,
        ...(['low', 'minimal'].includes(effort ?? '')
          ? { generation_config: { thinking_level: effort } }
          : {}),
      },
    };
  return {
    ...common,
    url,
    headers: { 'x-api-key': secret, 'anthropic-version': settings.anthropicVersion },
    body: {
      model,
      max_tokens: cap,
      messages: [{ role: 'user', content: prompt }],
      ...(route.anthropic_thinking ? { thinking: { type: route.anthropic_thinking } } : {}),
    },
  };
}
