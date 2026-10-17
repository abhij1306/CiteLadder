import { z } from 'zod';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { approvedEndpoint } from '../providers/connections.ts';
import { providerPolicy, type Engine } from '../providers/config.ts';
import { dataforseoAccountIdentity } from '../providers/dataforseo-identity.ts';
import type { CapacityRequest } from '../providers/capacity.ts';
import { createSecretCipher } from '../integrations/fernet.ts';
import { ProviderError, answerRequestSchema } from '../answer-engines/contracts.ts';
import { ownedAuditTask, type AuditTask } from '../queue/audit-queue.ts';
import {
  searchPolicy,
  searchPayload,
  type SearchEngine,
  type SearchRequest,
} from '../search-surfaces/dataforseo.ts';
import { auditPolicy, type AuditRuntime } from './config.ts';

const routeSchema = z.object({
  connection_id: z.uuid(),
  credential_source: z.literal('byok'),
  logical_engine: z.string(),
  transport_provider: z.string(),
  transport_model: z.string(),
  base_url: z.string(),
  reasoning_effort: z.string().nullable(),
});
const unavailable = () => new ProviderError(auditPolicy.constants.error_no_connection);

type RouteSnapshot = z.infer<typeof routeSchema>;
function assertRouteMatchesCatalog(task: AuditTask, route: RouteSnapshot) {
  const catalog = providerPolicy.routes[task.logical_engine as Engine];
  if (
    !catalog ||
    catalog.transport_provider !== task.transport_provider ||
    catalog.transport_model !== task.transport_model ||
    route.logical_engine !== task.logical_engine ||
    route.transport_provider !== task.transport_provider ||
    route.transport_model !== task.transport_model
  )
    throw new ProviderError(providerPolicy.errors.invalid_surface);
}
async function loadActiveConnection(db: Database, route: RouteSnapshot, task: AuditTask, at: Date) {
  const connection = await db
    .selectFrom('provider_connections as c')
    .selectAll('c')
    .where('c.id', '=', route.connection_id)
    .where('c.credential_source', '=', route.credential_source)
    .where('c.transport_provider', '=', route.transport_provider)
    .where('c.workspace_id', '=', task.workspace_id)
    .forShare('c')
    .executeTakeFirst();
  if (
    !connection?.active ||
    connection.last_test_status !== 'ok' ||
    (connection.paused_at && (!connection.pause_until || connection.pause_until > at))
  )
    throw unavailable();
  return connection;
}
/** The execution secret exists only in this detached context, never in snapshots or logs. */
export async function loadExecutionContext(
  db: Database,
  claimed: AuditTask,
  owner: string,
  runtime: AuditRuntime,
  encryptionKey: string,
  at = new Date(),
) {
  return db.transaction().execute(async (trx) => {
    const locked = await ownedAuditTask(trx, claimed, owner);
    if (!locked) return null;
    const { task, audit } = locked;
    const parsed = routeSchema.safeParse(task.provider_route_snapshot);
    if (!parsed.success) throw unavailable();
    const route = parsed.data;
    assertRouteMatchesCatalog(task, route);
    const connection = await loadActiveConnection(trx, route, task, at);
    if (
      task.provider_submission_ref &&
      (task.provider_connection_id !== connection.id ||
        task.provider_credential_revision !== connection.credential_revision)
    )
      throw new ProviderError('connection_changed');
    let secret: string;
    try {
      secret = createSecretCipher(encryptionKey).decrypt(connection.api_key_encrypted);
    } catch {
      throw unavailable();
    }
    const endpoint = approvedEndpoint(route.transport_provider, route.base_url, runtime.providers);
    const config = record(audit.configuration),
      measurement = record(config.measurement_policy);
    const capacity: CapacityRequest = {
      taskId: task.id,
      attempt: task.attempt_count + 1,
      engine: task.logical_engine,
      transport: task.transport_provider,
      connectionId: connection.id,
      accountPoolIdentity:
        task.transport_provider === 'dataforseo'
          ? dataforseoAccountIdentity(connection.api_key_encrypted, encryptionKey)
          : '',
    };
    return {
      task,
      audit,
      route,
      connectionId: connection.id,
      connectionWorkspaceId: connection.workspace_id,
      revision: connection.credential_revision,
      secret,
      endpoint,
      config,
      measurement,
      capacity,
    };
  });
}
export type ExecutionContext = NonNullable<Awaited<ReturnType<typeof loadExecutionContext>>>;
export function directRequest(context: ExecutionContext) {
  const { task, audit, config, measurement } = context;
  const parsed = answerRequestSchema.safeParse({
    logical_engine: task.logical_engine,
    transport_provider: task.transport_provider,
    transport_model: task.transport_model,
    prompt: task.prompt_text,
    system_instruction: audit.system_instruction,
    timeout_seconds: measurement.timeout_seconds,
    max_output_tokens: measurement.max_output_tokens,
    retrieval_enabled: measurement.retrieval_enabled,
    reasoning_effort: record(context.route).reasoning_effort,
    country_code: config.country_code ?? '',
    anthropic_max_uses: config.anthropic_max_uses ?? 0,
  });
  if (!parsed.success) throw new ProviderError('parse_error');
  return parsed.data;
}
export function frozenSurfaceRequest(
  context: ExecutionContext,
  submissionRef: string,
  runtime: AuditRuntime,
): SearchRequest {
  const snapshot = record(context.task.request_snapshot);
  const request: SearchRequest = {
    query: context.task.prompt_text,
    location_code: z.number().int().positive().parse(snapshot.location_code),
    language_code: z.string().min(1).parse(snapshot.language_code),
    device: z.enum(['desktop', 'mobile']).parse(snapshot.device),
    depth: searchPolicy.constants.default_depth,
    load_async_ai_overview: searchPolicy.constants.load_async_ai_overview,
    timeout_seconds: z
      .number()
      .positive()
      .parse(snapshot.timeout_seconds ?? runtime.search.timeoutSeconds),
    provider_submission_ref: submissionRef,
    request_settings: record(snapshot.request_settings),
  };
  searchPayload(context.task.logical_engine as SearchEngine, request);
  return request;
}
/** An authenticated provider failure pauses this concrete revision; a concurrent rotation wins. */
export function pauseExecutionCredential(
  db: Database,
  context: ExecutionContext,
  runtime: AuditRuntime,
  at: Date,
) {
  return db
    .updateTable('provider_connections')
    .set({
      paused_at: at,
      pause_until: new Date(at.getTime() + runtime.providers.keyGraceDays * 86400000),
      pause_reason: 'auth',
      updated_at: at,
    })
    .where('id', '=', context.connectionId)
    .where('workspace_id', '=', context.connectionWorkspaceId)
    .where('credential_source', '=', context.route.credential_source)
    .where('credential_revision', '=', context.revision)
    .execute();
}
