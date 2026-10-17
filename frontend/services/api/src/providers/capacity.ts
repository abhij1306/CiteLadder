import { randomUUID } from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import type { Database } from '../db/database.ts';
import type { ProviderCapacityBuckets } from '../generated/db-schema.ts';
import { policy } from '../config.ts';
import { auditPolicy, type AuditRuntime } from '../audits/config.ts';
import { getLogger } from '../logging.ts';
import { firstOf } from '../lists.ts';

const logger = getLogger('providers.capacity');
type Bucket = Selectable<ProviderCapacityBuckets>;
type RoutePolicy = (typeof policy.providers.capacity)[number];
type Pool = {
  kind: 'transport' | 'connection';
  connectionId: string | null;
  identity: string;
};
export type CapacityRequest = {
  taskId: string | null;
  analyticsTaskId?: string;
  attempt: number;
  engine: string;
  transport: string;
  connectionId: string;
  accountPoolIdentity?: string;
};
export type CapacityDecision =
  | { acquired: true; leaseIds: string[] }
  | {
      acquired: false;
      availableAt: Date;
      code: string;
      poolKind: Pool['kind'];
    };
function routeCapacity(request: CapacityRequest): RoutePolicy {
  const row = policy.providers.capacity.find(
    (row) => row.logical_engine === request.engine && row.transport_provider === request.transport,
  );
  if (!row) throw new Error('Unknown provider capacity route');
  return row;
}
function pools(request: CapacityRequest): Pool[] {
  if (
    (request.taskId === null) === !request.analyticsTaskId ||
    !Number.isSafeInteger(request.attempt) ||
    request.attempt < 1
  )
    throw new Error('Capacity request requires one task parent and positive attempt');
  const transport: Pool = {
    kind: 'transport',
    connectionId: null,
    identity: request.accountPoolIdentity ?? '',
  };
  return [transport, { ...transport, kind: 'connection', connectionId: request.connectionId }];
}
function ceiling(route: RoutePolicy, runtime: AuditRuntime) {
  return route.max_concurrency ?? runtime.audits.per_transport_concurrency;
}
function bucketQuery(db: Database, request: CapacityRequest, pool: Pool) {
  return db
    .selectFrom('provider_capacity_buckets')
    .selectAll()
    .where('pool_kind', '=', pool.kind)
    .where('transport_provider', '=', request.transport)
    .where('account_pool_identity', '=', pool.identity)
    .where('connection_id', pool.connectionId === null ? 'is' : '=', pool.connectionId)
    .where('billing_account_id', 'is', null)
    .forUpdate();
}
async function lockBuckets(
  db: Database,
  request: CapacityRequest,
  route: RoutePolicy,
  runtime: AuditRuntime,
  at: Date,
  create: boolean,
) {
  const rows: { pool: Pool; bucket: Bucket }[] = [];
  // Both runtimes acquire this exact order: transport, then connection.
  for (const pool of pools(request)) {
    if (create)
      await db
        .insertInto('provider_capacity_buckets')
        .values({
          id: randomUUID(),
          pool_kind: pool.kind,
          transport_provider: request.transport,
          connection_id: pool.connectionId,
          billing_account_id: null,
          account_pool_identity: pool.identity,
          capacity: String(ceiling(route, runtime)),
          tokens: String(pool.kind === 'transport' ? (route.capacity ?? 0) : 0),
          refill_tokens_per_second: String(route.refill_tokens_per_second ?? 0),
          refilled_at: at,
          policy_version: auditPolicy.constants.capacity_policy_version,
          blocked_until: null,
          created_at: at,
          updated_at: at,
        })
        .onConflict((conflict) => conflict.doNothing())
        .execute();
    let bucket = await bucketQuery(db, request, pool).executeTakeFirst();
    if (!bucket) continue;
    if (create)
      bucket = await db
        .updateTable('provider_capacity_buckets')
        .set({
          capacity: String(ceiling(route, runtime)),
          ...(pool.kind === 'transport'
            ? { refill_tokens_per_second: String(route.refill_tokens_per_second ?? 0) }
            : {}),
          policy_version: auditPolicy.constants.capacity_policy_version,
          updated_at: at,
        })
        .where('id', '=', bucket.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    rows.push({ pool, bucket });
  }
  return rows;
}
function parked(pool: Pool, code: string, availableAt: Date): CapacityDecision {
  return { acquired: false, code, poolKind: pool.kind, availableAt };
}
async function refusal(
  db: Database,
  request: CapacityRequest,
  rows: Awaited<ReturnType<typeof lockBuckets>>,
  route: RoutePolicy,
  runtime: AuditRuntime,
  at: Date,
): Promise<CapacityDecision | null> {
  for (const { pool, bucket } of rows) {
    if (bucket.blocked_until && bucket.blocked_until > at)
      return parked(pool, auditPolicy.constants.capacity_code_rate_limited, bucket.blocked_until);
    const active = await db
      .selectFrom('provider_capacity_leases')
      .select(sql<boolean>`coalesce(sum(units),0) + 1 > ${bucket.capacity}::numeric`.as('full'))
      .where('bucket_id', '=', bucket.id)
      .where('released_at', 'is', null)
      .where('expires_at', '>', at)
      .executeTakeFirstOrThrow();
    if (active.full)
      return parked(
        pool,
        auditPolicy.constants.capacity_code_concurrency,
        new Date(at.getTime() + runtime.audits.capacity_concurrency_retry_seconds * 1000),
      );
    if (pool.kind !== 'transport') continue;
    if (route.capacity === null || route.refill_tokens_per_second === null) continue;
    const balance = await db
      .updateTable('provider_capacity_buckets')
      .set({
        tokens: sql`least(${route.capacity}::numeric, tokens + greatest(0, extract(epoch from ${at}::timestamptz - refilled_at)) * ${route.refill_tokens_per_second}::numeric)`,
        refilled_at: at,
        updated_at: at,
      })
      .where('id', '=', bucket.id)
      .returning([
        sql<boolean>`tokens >= 1`.as('ready'),
        sql<number>`case when refill_tokens_per_second > 0 then ((1 - tokens) / refill_tokens_per_second)::float8 else ${route.max_cooldown_seconds}::float8 end`.as(
          'wait',
        ),
      ])
      .executeTakeFirstOrThrow();
    if (!balance.ready)
      return parked(
        pool,
        auditPolicy.constants.capacity_code_rate_limited,
        new Date(at.getTime() + balance.wait * 1000),
      );
  }
  return null;
}

/** One call start consumes one token and leases one unit in every applicable pool. */
export async function acquireCapacity(
  db: Database,
  request: CapacityRequest,
  runtime: AuditRuntime,
  at = new Date(),
): Promise<CapacityDecision> {
  const route = routeCapacity(request);
  const decision = await db.transaction().execute(async (trx): Promise<CapacityDecision> => {
    const rows = await lockBuckets(trx, request, route, runtime, at, true);
    const blocked = await refusal(trx, request, rows, route, runtime, at);
    if (blocked) return blocked;
    const leaseIds: string[] = [];
    for (const { bucket } of rows) {
      const prior = await trx
        .selectFrom('provider_capacity_leases')
        .select('id')
        .where('bucket_id', '=', bucket.id)
        .where('task_id', request.taskId === null ? 'is' : '=', request.taskId)
        .where(
          'analytics_task_id',
          request.analyticsTaskId ? '=' : 'is',
          request.analyticsTaskId ?? null,
        )
        .where('attempt_number', '=', request.attempt)
        .where('lease_kind', '=', 'concurrency')
        .executeTakeFirst();
      const expiry = new Date(at.getTime() + runtime.audits.capacity_lease_ttl_seconds * 1000);
      if (prior) {
        await trx
          .updateTable('provider_capacity_leases')
          .set({ units: '1', released_at: null, expires_at: expiry, updated_at: at })
          .where('id', '=', prior.id)
          .execute();
        leaseIds.push(prior.id);
      } else {
        const id = randomUUID();
        await trx
          .insertInto('provider_capacity_leases')
          .values({
            id,
            bucket_id: bucket.id,
            task_id: request.taskId,
            analytics_task_id: request.analyticsTaskId ?? null,
            attempt_number: request.attempt,
            lease_kind: 'concurrency',
            units: '1',
            expires_at: expiry,
            released_at: null,
            created_at: at,
            updated_at: at,
          })
          .execute();
        leaseIds.push(id);
      }
    }
    if (route.capacity !== null && route.refill_tokens_per_second !== null)
      await trx
        .updateTable('provider_capacity_buckets')
        .set({ tokens: sql`tokens - 1` })
        .where('id', '=', firstOf(rows, 'the locked transport bucket').bucket.id)
        .execute();
    return { acquired: true, leaseIds };
  });
  if (!decision.acquired)
    logger.info(
      decision.code === auditPolicy.constants.capacity_code_concurrency
        ? 'audit.capacity.wait'
        : 'audit.capacity.rate_limited',
      {
        pool_kind: decision.poolKind,
        transport_provider: request.transport,
        task_id: request.taskId,
        retry_after_seconds: Math.max(0, (decision.availableAt.getTime() - at.getTime()) / 1000),
      },
    );
  return decision;
}
/** Release concurrency only. Provider rate limits raise a shared, bounded cooldown. */
export function releaseCapacity(
  db: Database,
  request: CapacityRequest,
  runtime: AuditRuntime,
  outcome: { rateLimited?: boolean; retryAfterSeconds?: number | null },
  at = new Date(),
) {
  const route = routeCapacity(request);
  return db.transaction().execute(async (trx) => {
    const rows = await lockBuckets(trx, request, route, runtime, at, false);
    if (!rows.length) return;
    await trx
      .updateTable('provider_capacity_leases')
      .set({ released_at: at, updated_at: at })
      .where(
        'bucket_id',
        'in',
        rows.map(({ bucket }) => bucket.id),
      )
      .where('task_id', request.taskId === null ? 'is' : '=', request.taskId)
      .where(
        'analytics_task_id',
        request.analyticsTaskId ? '=' : 'is',
        request.analyticsTaskId ?? null,
      )
      .where('attempt_number', '=', request.attempt)
      .where('lease_kind', '=', 'concurrency')
      .where('released_at', 'is', null)
      .execute();
    if (outcome.rateLimited) {
      const hint = outcome.retryAfterSeconds;
      const seconds =
        typeof hint === 'number' && Number.isFinite(hint)
          ? Math.min(Math.max(0, hint), route.max_cooldown_seconds)
          : route.max_cooldown_seconds;
      const until = new Date(at.getTime() + seconds * 1000);
      await trx
        .updateTable('provider_capacity_buckets')
        .set({ blocked_until: sql`greatest(blocked_until, ${until}::timestamptz)`, updated_at: at })
        .where(
          'id',
          'in',
          rows.map(({ bucket }) => bucket.id),
        )
        .execute();
      logger.info('audit.capacity.rate_limited', {
        transport_provider: request.transport,
        task_id: request.taskId,
        retry_after_seconds: seconds,
      });
    }
  });
}
