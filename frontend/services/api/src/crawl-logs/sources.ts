import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../db/database.ts';
import { hash } from '../traffic/normalization.ts';
import { crawlLogs } from '../config/crawl-logs.ts';
import { ApiError, notFound } from '../errors.ts';
import { recordSecurityEvent } from '../auth/security-events.ts';
import { lockAuthorizedWorkspace } from '../workspaces/service.ts';
import { lockCrawlState, enqueueRollup, type CrawlScope } from './state.ts';
import { enqueueTrafficInsights } from './insights-enqueue.ts';
import { asApiErrorCode } from '@citeladder/contracts/error-codes';
import { crawlers } from '../config/crawlers.ts';
import { requirePubSubReader } from './gcp-client.ts';
import { crawlLogAvailabilitySchema } from '@citeladder/contracts/ai-traffic';

const samplingSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('sampled'), rate: z.number().gt(0).max(1) }),
  z.strictObject({ kind: z.literal('filtered'), description: z.string().trim().min(1).max(512) }),
]);
/** `projects/<project id>/subscriptions/<subscription id>`, as Pub/Sub names them. */
const SUBSCRIPTION =
  /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/subscriptions\/[A-Za-z][\w.~%+-]{2,254}$/u;
export const createSourceSchema = z
  .strictObject({
    setup: z.enum([
      'cloudflare_worker',
      'cloudflare_logpush',
      'aws_firehose',
      'gcp_pubsub_pull',
      'custom',
      'upload',
    ]),
    origin: z.url().max(512),
    format: z.enum(['ndjson', 'json_array', 'combined']).default('ndjson'),
    collection_point: z.enum(['cdn_edge', 'origin', 'application', 'uploaded_file']).optional(),
    sampling: samplingSchema.optional(),
    /** Firehose buffer interval declared at setup; it widens the coverage gap bound. */
    buffer_interval_seconds: z.int().min(60).max(900).optional(),
    /** The stream runs CiteLadder's filter Lambda, so quiet periods send nothing. */
    declared_filtered: z.boolean().optional(),
    /** The Pub/Sub subscription a Google Cloud pull source drains. */
    subscription: z.string().max(255).regex(SUBSCRIPTION).optional(),
    /** The load balancer logging sample rate the customer configured. */
    declared_sample_rate: z.number().min(0.001).max(1).multipleOf(0.001).optional(),
  })
  .refine(
    (input) =>
      input.setup === 'aws_firehose'
        ? input.buffer_interval_seconds !== undefined &&
          input.collection_point === undefined &&
          input.sampling === undefined &&
          input.format === 'ndjson'
        : input.buffer_interval_seconds === undefined && input.declared_filtered === undefined,
    {
      message:
        'An Amazon Firehose source declares its buffer interval and filter only; other setups declare neither',
    },
  )
  .refine(
    (input) =>
      input.setup === 'gcp_pubsub_pull'
        ? input.subscription !== undefined &&
          input.collection_point === undefined &&
          input.sampling === undefined &&
          input.format === 'ndjson'
        : input.subscription === undefined && input.declared_sample_rate === undefined,
    {
      message:
        'A Google Cloud source declares its subscription and sample rate only; other setups declare neither',
    },
  );
/** A Firehose stream through the filter Lambda keeps recognized crawlers only. */
const FIREHOSE_FILTERED = {
  kind: 'filtered',
  description: 'CiteLadder filter Lambda: recognized crawler requests only',
} as const;
/** Each setup's mapping preset and source kind. */
const SETUPS = {
  cloudflare_worker: { preset: 'cloudflare_worker_template', kind: 'webhook' },
  cloudflare_logpush: { preset: 'cloudflare_logpush_http_requests', kind: 'webhook' },
  aws_firehose: { preset: 'cloudfront_v2_json', kind: 'webhook' },
  gcp_pubsub_pull: { preset: 'gcp_log_entry', kind: 'pull' },
  custom: { preset: 'custom_ndjson', kind: 'webhook' },
  upload: { preset: 'custom_ndjson', kind: 'upload' },
} as const satisfies Record<
  z.output<typeof createSourceSchema>['setup'],
  { preset: string; kind: string }
>;
type SourceKind = (typeof SETUPS)[keyof typeof SETUPS]['kind'];
const LIVE: readonly string[] = ['webhook', 'pull'] satisfies readonly SourceKind[];
/** Sources that collect continuously; one per host may be live. */
export const isLiveKind = (kind: string) => LIVE.includes(kind);
const token = () => 'clw_' + randomBytes(32).toString('base64url');
const NONCE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
/** 26 lowercase base32 characters: a valid GCP label value. 256 % 32 = 0, so unbiased. */
const nonce = () => [...randomBytes(26)].map((byte) => NONCE_ALPHABET[byte % 32]).join('');
/** The columns only a pull source carries; null for webhooks and uploads. */
function pullColumns(input: z.output<typeof createSourceSchema>) {
  if (input.setup !== 'gcp_pubsub_pull' || input.subscription === undefined)
    return {
      subscription: null,
      verification_nonce: null,
      filter_catalog_version: null,
      declared_sample_rate: null,
    };
  return {
    subscription: input.subscription,
    verification_nonce: nonce(),
    filter_catalog_version: crawlers.catalog_version,
    declared_sample_rate: String(input.declared_sample_rate ?? 1),
  };
}
function sourceSampling(
  input: z.output<typeof createSourceSchema>,
  defaults: (typeof crawlLogs.presets)[string],
) {
  if (input.declared_filtered) return FIREHOSE_FILTERED;
  const rate = input.declared_sample_rate ?? 1;
  if (input.setup === 'gcp_pubsub_pull' && rate < 1) return { kind: 'sampled', rate } as const;
  return input.sampling ?? defaults.sampling;
}
export type CrawlLogAvailability = z.infer<typeof crawlLogAvailabilitySchema>;
/** Collection is available unless the operator's global kill switch is off. */
export function crawlLogAvailability(): CrawlLogAvailability {
  return crawlLogs.ingestion_enabled ? 'available' : 'disabled';
}
export function requireCrawlLogs() {
  if (crawlLogAvailability() === 'disabled')
    throw new ApiError(409, 'Crawl log collection is paused', {
      code: asApiErrorCode('crawl_logs_disabled'),
    });
}
export async function createSource(
  db: Database,
  scope: CrawlScope,
  actorId: string,
  input: z.output<typeof createSourceSchema>,
) {
  let origin: URL;
  try {
    origin = new URL(input.origin);
  } catch {
    throw new ApiError(422, 'Invalid origin');
  }
  if (
    !['https:', 'http:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.port ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new ApiError(422, 'Use a site origin without a path or credentials');
  const host = origin.hostname.toLowerCase();
  const { preset, kind } = SETUPS[input.setup];
  const defaults = crawlLogs.presets[preset]!;
  const sampling = sourceSampling(input, defaults);
  if (kind === 'pull') requirePubSubReader();
  return await db.transaction().execute(async (trx) => {
    await lockAuthorizedWorkspace(trx, scope.workspaceId, actorId, 'manage_credentials');
    requireCrawlLogs();
    const project = await trx
      .selectFrom('projects')
      .select('website_url')
      .where('workspace_id', '=', scope.workspaceId)
      .where('id', '=', scope.projectId)
      .executeTakeFirst();
    if (!project) throw notFound('Project');
    const domains = await trx
      .selectFrom('owned_domains')
      .innerJoin('projects', 'projects.id', 'owned_domains.project_id')
      .select('owned_domains.domain')
      .where('projects.workspace_id', '=', scope.workspaceId)
      .where('projects.id', '=', scope.projectId)
      .execute();
    const hosts = [
      new URL(project.website_url).hostname,
      ...domains.map((d) => d.domain.toLowerCase()),
    ];
    if (!hosts.includes(host)) throw new ApiError(422, 'Host is outside the project scope');
    await lockCrawlState(trx, scope);
    const existing = await trx
      .selectFrom('crawl_log_sources')
      .select(['kind', 'host', 'status'])
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .execute();
    if (existing.filter((s) => s.status === 'active').length >= crawlLogs.max_sources_per_project)
      throw new ApiError(429, 'Source limit reached');
    if (
      isLiveKind(kind) &&
      existing.some((s) => s.host === host && isLiveKind(s.kind) && s.status === 'active')
    )
      throw new ApiError(409, 'An active live source already covers this host');
    const member = await trx
      .selectFrom('workspace_members')
      .select('id')
      .where('workspace_id', '=', scope.workspaceId)
      .where('user_id', '=', actorId)
      .executeTakeFirstOrThrow();
    // Only a webhook authenticates its sender; a pull source holds no secret.
    const secret = kind === 'webhook' ? token() : null;
    const id = randomUUID();
    await trx
      .insertInto('crawl_log_sources')
      .values({
        id,
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        kind,
        setup: input.setup,
        preset,
        format: input.format,
        collection_point:
          input.setup === 'upload'
            ? 'uploaded_file'
            : (input.collection_point ?? defaults.collection_point),
        sampling: JSON.stringify(sampling),
        origin: origin.origin,
        host,
        accepted_hosts: JSON.stringify([host]),
        token_hash: secret ? hash(secret) : null,
        token_prefix: secret?.slice(0, 12) ?? null,
        status: 'active',
        created_by_member_id: member.id,
        created_at: new Date(),
        revoked_at: null,
        last_processed_at: null,
        buffer_interval_seconds: input.buffer_interval_seconds ?? null,
        declared_filtered: input.declared_filtered ?? false,
        ...pullColumns(input),
      })
      .execute();
    await recordSecurityEvent(trx, 'crawl_log.create', actorId, scope.workspaceId, id);
    await enqueueTrafficInsights(trx, scope);
    return { id, token: secret };
  });
}
export async function mutateSource(
  db: Database,
  scope: CrawlScope,
  actorId: string,
  id: string,
  action: 'rotate' | 'revoke',
) {
  return await db.transaction().execute(async (trx) => {
    await lockAuthorizedWorkspace(trx, scope.workspaceId, actorId, 'manage_credentials');
    await lockCrawlState(trx, scope);
    const source = await trx
      .selectFrom('crawl_log_sources')
      .selectAll()
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!source) throw notFound('Crawl log source');
    if (action === 'rotate' && (source.status !== 'active' || source.kind !== 'webhook'))
      throw new ApiError(409, 'Source cannot rotate');
    // Revocation is idempotent: the first revoked_at is the audit and coverage boundary.
    if (action === 'revoke' && source.status === 'revoked') return { id, token: null };
    const secret = action === 'rotate' ? token() : null;
    await trx
      .updateTable('crawl_log_sources')
      .set(
        action === 'rotate'
          ? { token_hash: hash(secret!), token_prefix: secret!.slice(0, 12) }
          : { status: 'revoked', revoked_at: new Date() },
      )
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('id', '=', id)
      .execute();
    await recordSecurityEvent(
      trx,
      action === 'rotate' ? 'crawl_log.rotate' : 'crawl_log.revoke',
      actorId,
      scope.workspaceId,
      id,
    );
    if (action === 'revoke') await enqueueRollup(trx, scope, new Date());
    await enqueueTrafficInsights(trx, scope);
    return { id, token: secret };
  });
}
/** The project's live pull source with this id, or undefined. */
export function findLivePullSource(db: Database, scope: CrawlScope, id: string) {
  return db
    .selectFrom('crawl_log_sources')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', id)
    .where('kind', '=', 'pull')
    .where('status', '=', 'active')
    .executeTakeFirst();
}
/** A live pull source in the project, for a command that acts on it. */
export async function pullSourceFor(db: Database, scope: CrawlScope, id: string) {
  const source = await findLivePullSource(db, scope, id);
  if (source) return source;
  const exists = await db
    .selectFrom('crawl_log_sources')
    .select('id')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', id)
    .executeTakeFirst();
  if (!exists) throw notFound('Crawl log source');
  throw new ApiError(409, 'Only a live Google Cloud source has a subscription to check');
}
/**
 * The customer installed the sink filter for the current crawler catalog. Days
 * from the next one on can reach complete coverage again.
 */
export async function confirmSinkFilter(
  db: Database,
  scope: CrawlScope,
  actorId: string,
  id: string,
) {
  return await db.transaction().execute(async (trx) => {
    await lockAuthorizedWorkspace(trx, scope.workspaceId, actorId, 'manage_credentials');
    await lockCrawlState(trx, scope);
    await pullSourceFor(trx, scope, id);
    const now = new Date();
    await trx
      .updateTable('crawl_log_sources')
      .set({ filter_catalog_version: crawlers.catalog_version, filter_confirmed_at: now })
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('id', '=', id)
      .execute();
    await enqueueRollup(trx, scope, now);
    return { id };
  });
}
export async function authorizeToken(db: Database, id: string, authorization: string | undefined) {
  const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  const source = await db
    .selectFrom('crawl_log_sources')
    .selectAll()
    .where('id', '=', id)
    .where('kind', '=', 'webhook')
    .executeTakeFirst();
  // Revoked sources retain their hash so a valid revoked token receives 409.
  const expected = Buffer.from(source?.token_hash ?? hash('invalid'), 'hex');
  const actual = Buffer.from(hash(supplied), 'hex');
  if (!source || !supplied || !timingSafeEqual(actual, expected))
    throw new ApiError(401, 'Invalid crawl log token');
  if (source.status !== 'active') throw new ApiError(409, 'Crawl log source revoked');
  requireCrawlLogs();
  return source;
}
