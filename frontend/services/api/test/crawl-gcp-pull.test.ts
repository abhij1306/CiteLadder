import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';
import { crawlLogs } from '../src/config/crawl-logs.ts';
import { confirmSinkFilter, createSource, createSourceSchema } from '../src/crawl-logs/sources.ts';
import { ingest } from '../src/crawl-logs/ingest.ts';
import { verifyPullSource } from '../src/crawl-logs/gcp-verify.ts';
import { sourceList } from '../src/crawl-logs/source-reads.ts';
import { gcpLogFilter } from '../src/crawl-logs/gcp-filter.ts';
import { GcpError, pubSubReader } from '../src/crawl-logs/gcp-client.ts';
import { crawlLogPull, enqueueDuePulls } from '../src/crawl-logs/pull.ts';
import { refreshCrawlLogs } from '../src/crawl-logs/rollup.ts';
import { TaskQueue } from '../src/queue/task-queue.ts';
import { enqueueTask } from '../src/referrals/enqueue.ts';

/** An in-memory Google: metadata, IAM Credentials and one Pub/Sub subscription. */
function fakeGoogle(
  options: {
    labels?: Record<string, string>;
    push?: boolean;
    ackDeadline?: number;
    status?: number;
    tokenLifetimeMs?: number;
  } = {},
) {
  const state = {
    messages: [] as { messageId: string; data: string }[],
    acked: [] as string[],
    tokensMinted: 0,
    pulls: 0,
    status: options.status ?? 200,
    clock: Date.parse('2026-10-10T00:00:00Z'),
    log: [] as string[],
    labels: options.labels ?? {},
    /** When set, `status` applies to this call only (subscription `get`, `:pull` or `:acknowledge`). */
    failing: '' as '' | 'get' | ':pull' | ':acknowledge',
    /** Runs when an acknowledgement arrives, before it is applied. */
    onAck: async () => {},
  };
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const transport = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const authorization = new Headers(init?.headers).get('authorization');
    state.log.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.startsWith('http://metadata.google.internal/'))
      return reply(200, { access_token: 'runtime-token' });
    if (url.startsWith('https://iamcredentials.googleapis.com/')) {
      if (authorization !== 'Bearer runtime-token') return reply(401, {});
      state.tokensMinted += 1;
      return reply(200, {
        accessToken: 'reader-token-' + state.tokensMinted,
        expireTime: new Date(state.clock + (options.tokenLifetimeMs ?? 900_000)).toISOString(),
      });
    }
    if (!authorization?.startsWith('Bearer reader-token-')) return reply(401, {});
    const call = /:(pull|acknowledge)$/u.exec(url)?.[0] ?? 'get';
    if (state.status !== 200 && (!state.failing || call === state.failing))
      return reply(state.status, { error: { message: 'secret detail' } });
    if (url.endsWith(':pull')) {
      state.pulls += 1;
      const { maxMessages } = JSON.parse(String(init?.body)) as { maxMessages: number };
      const batch = state.messages
        .filter((m) => !state.acked.includes(m.messageId))
        .slice(0, maxMessages);
      return reply(200, {
        receivedMessages: batch.map((message) => ({ ackId: 'ack-' + message.messageId, message })),
      });
    }
    if (url.endsWith(':acknowledge')) {
      const { ackIds } = JSON.parse(String(init?.body)) as { ackIds: string[] };
      await state.onAck();
      state.acked.push(...ackIds.map((id) => id.slice(4)));
      return reply(200, {});
    }
    return reply(200, {
      name: SUBSCRIPTION,
      labels: state.labels,
      pushConfig: options.push ? { pushEndpoint: 'https://example.test/push' } : {},
      ackDeadlineSeconds: options.ackDeadline ?? 120,
    });
  };
  const reader = pubSubReader({ readerEmail: READER, transport, now: () => state.clock });
  return { state, reader, transport };
}

const config = testConfig(),
  db = testDatabase(config),
  fixtures = new VisibilityFixtures(db);
const original = { ...crawlLogs };
const READER = 'citeladder-log-reader@example-project.iam.gserviceaccount.com';
const SUBSCRIPTION = 'projects/acme-prod/subscriptions/citeladder-ai-crawlers-sub';
const scope = (t: Tenant) => ({ workspaceId: t.workspaceId, projectId: t.projectId });

async function pullSource(tenant?: Tenant, rate?: number) {
  const owner = tenant ?? (await fixtures.tenant());
  const created = await createSource(db, scope(owner), owner.userId, {
    setup: 'gcp_pubsub_pull',
    origin: 'https://acme.example',
    format: 'ndjson',
    subscription: SUBSCRIPTION,
    ...(rate === undefined ? {} : { declared_sample_rate: rate }),
  });
  return { tenant: owner, id: created.id, token: created.token };
}

beforeAll(() => {
  crawlLogs.ingestion_enabled = true;
  process.env.CRAWL_LOG_READER_EMAIL = READER;
});
afterAll(async () => {
  Object.assign(crawlLogs, original);
  delete process.env.CRAWL_LOG_READER_EMAIL;
  await fixtures.cleanup();
  await db.destroy();
});

describe('Google Cloud pull sources', () => {
  it('creates a tokenless source awaiting verification, visible to its workspace only', async () => {
    const { tenant, id, token } = await pullSource(undefined, 0.5);
    const other = await fixtures.tenant();
    expect(token).toBeNull();
    const list = await sourceList(db, scope(tenant));
    expect(list.gcp_pull).toMatchObject({ availability: 'available', reader_email: READER });
    const [item] = list.items;
    expect(item).toMatchObject({
      id,
      kind: 'pull',
      setup: 'gcp_pubsub_pull',
      preset: 'gcp_log_entry',
      collection_point: 'cdn_edge',
      sampling: { kind: 'sampled', rate: 0.5 },
      state: 'awaiting_verification',
      token_prefix: null,
      pull: {
        subscription: SUBSCRIPTION,
        verified_at: null,
        filter_current: true,
        declared_sample_rate: 0.5,
        last_drained_at: null,
      },
    });
    expect(item!.pull!.verification_nonce).toMatch(/^[a-z2-7]{26}$/u);
    expect((await sourceList(db, scope(other))).items).toEqual([]);
  });
  it('keeps one live source per host across webhook and pull kinds', async () => {
    const tenant = await fixtures.tenant();
    await createSource(db, scope(tenant), tenant.userId, {
      setup: 'custom',
      origin: 'https://acme.example',
      format: 'ndjson',
    });
    await expect(pullSource(tenant)).rejects.toMatchObject({
      status: 409,
      message: 'An active live source already covers this host',
    });
    // The database index refuses the same pair even past the service check.
    const { id } = await pullSource();
    const source = await db
      .selectFrom('crawl_log_sources')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    await expect(
      db
        .insertInto('crawl_log_sources')
        .values({
          ...source,
          sampling: JSON.stringify(source.sampling),
          accepted_hosts: JSON.stringify(source.accepted_hosts),
          id: crypto.randomUUID(),
          kind: 'webhook',
          setup: 'custom',
          subscription: null,
          verification_nonce: null,
          filter_catalog_version: null,
          declared_sample_rate: null,
        })
        .execute(),
    ).rejects.toThrow(/uq_crawl_log_live_host/u);
  });
  it('accepts a subscription path only on the Google Cloud setup', () => {
    const parse = (input: Record<string, unknown>) =>
      createSourceSchema.safeParse({ origin: 'https://acme.example', ...input }).success;
    expect(parse({ setup: 'gcp_pubsub_pull', subscription: SUBSCRIPTION })).toBe(true);
    expect(parse({ setup: 'gcp_pubsub_pull' })).toBe(false);
    expect(parse({ setup: 'gcp_pubsub_pull', subscription: 'acme-prod/citeladder' })).toBe(false);
    expect(
      parse({ setup: 'gcp_pubsub_pull', subscription: SUBSCRIPTION, declared_sample_rate: 0 }),
    ).toBe(false);
    expect(parse({ setup: 'custom', subscription: SUBSCRIPTION })).toBe(false);
    expect(parse({ setup: 'custom', declared_sample_rate: 1 })).toBe(false);
  });
  it('hides the connector when no reader service account is configured', async () => {
    const tenant = await fixtures.tenant();
    process.env.CRAWL_LOG_READER_EMAIL = '';
    try {
      expect((await sourceList(db, scope(tenant))).gcp_pull).toMatchObject({
        availability: 'pull_unavailable',
        reader_email: null,
      });
      await expect(pullSource(tenant)).rejects.toMatchObject({ status: 409 });
    } finally {
      process.env.CRAWL_LOG_READER_EMAIL = READER;
    }
  });
});

describe('sink filter', () => {
  it('escapes RE2 metacharacters and string quotes in every catalog pattern', () => {
    const filter = gcpLogFilter({
      bots: [
        { ua_patterns: ['gptbot/1.0', 'a+b(c)'] },
        { ua_patterns: ['say "hi"', 'gptbot/1.0'] },
      ],
    });
    expect(filter).toBe(
      [
        '(resource.type="http_load_balancer"',
        '  OR (resource.type="cloud_run_revision" AND log_id("run.googleapis.com/requests")))',
        String.raw`AND httpRequest.userAgent=~"(?i)(a\\+b\\(c\\)|gptbot/1\\.0|say \"hi\")"`,
      ].join('\n'),
    );
  });
});

describe('Google REST client', () => {
  it('reuses the reader token until shortly before it expires, then mints another', async () => {
    const google = fakeGoogle();
    await google.reader.subscription(SUBSCRIPTION);
    google.state.clock += 830_000;
    await google.reader.subscription(SUBSCRIPTION);
    expect(google.state.tokensMinted).toBe(1);
    google.state.clock += 20_000;
    await google.reader.subscription(SUBSCRIPTION);
    expect(google.state.tokensMinted).toBe(2);
    const pubsubCalls = google.state.log.filter(
      (line) => new URL(line.split(' ')[1]!).host === 'pubsub.googleapis.com',
    );
    expect(pubsubCalls).toEqual([
      'GET https://pubsub.googleapis.com/v1/projects/acme-prod/subscriptions/citeladder-ai-crawlers-sub',
      'GET https://pubsub.googleapis.com/v1/projects/acme-prod/subscriptions/citeladder-ai-crawlers-sub',
      'GET https://pubsub.googleapis.com/v1/projects/acme-prod/subscriptions/citeladder-ai-crawlers-sub',
    ]);
  });
  it.each([
    [403, 'permission_denied'],
    // A rejected reader token is CiteLadder's failure, not the customer's.
    [401, 'unavailable'],
    [404, 'not_found'],
    [400, 'invalid'],
    [503, 'unavailable'],
  ])('maps a %i subscription response to %s without its body', async (status, failure) => {
    const google = fakeGoogle({ status });
    const error = await google.reader.subscription(SUBSCRIPTION).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GcpError);
    expect(error).toMatchObject({ failure, message: 'gcp_' + failure });
  });
  it('reports a pull that runs out of time as unavailable, never as an empty drain', async () => {
    const google = fakeGoogle();
    const reader = pubSubReader({
      readerEmail: READER,
      transport: async (input, init) => {
        if (String(input).endsWith(':pull'))
          throw new DOMException('The operation timed out.', 'TimeoutError');
        return google.transport(input, init);
      },
    });
    await expect(reader.pull(SUBSCRIPTION, 10)).rejects.toMatchObject({ failure: 'unavailable' });
  });
  it('reports a failed token mint as unavailable, never as the customer denying access', async () => {
    const reader = pubSubReader({
      readerEmail: READER,
      transport: async () => new Response('{}', { status: 403 }),
    });
    await expect(reader.pull(SUBSCRIPTION, 10)).rejects.toMatchObject({ failure: 'unavailable' });
  });
});

/** The persisted source row as a pull source sees it. */
const row = (id: string) =>
  db.selectFrom('crawl_log_sources').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
/** A Google whose subscription carries this source's own nonce label. */
async function labelled(id: string, options: Parameters<typeof fakeGoogle>[0] = {}) {
  const source = await row(id);
  return fakeGoogle({ labels: { 'citeladder-source': source.verification_nonce! }, ...options });
}

describe('subscription verification', () => {
  it.each([
    [{ labels: { 'citeladder-source': 'someone-elses-nonce' } }, 'label_mismatch'],
    [{ push: true }, 'push_subscription'],
    [{ ackDeadline: 30 }, 'ack_deadline'],
    [{ status: 403 }, 'permission_denied'],
    [{ status: 404 }, 'not_found'],
  ] as const)('stalls on %j with %s', async (options, failure) => {
    const { tenant, id } = await pullSource();
    const google = await labelled(id, options);
    expect(await verifyPullSource(db, await row(id), google.reader)).toEqual({
      verified: false,
      failure,
    });
    expect((await sourceList(db, scope(tenant))).items[0]).toMatchObject({
      state: 'stalled',
      stall_reason: 'verification_failed',
      pull: { verified_at: null, verification_failure: failure },
    });
  });
  it('activates on a passing check and lifts a verification stall only through a check', async () => {
    const { tenant, id } = await pullSource();
    const google = await labelled(id, { ackDeadline: 30 });
    await verifyPullSource(db, await row(id), google.reader);
    const stalledAt = (await row(id)).stalled_at;
    // A heartbeat receipt cannot lift it: only the subscription owner fixing it can.
    await ingest(db, await row(id), Buffer.alloc(0), { key: 'pull-heartbeat' });
    expect((await row(id)).stall_reason).toBe('verification_failed');
    const again = await verifyPullSource(db, await row(id), google.reader);
    expect(again.failure).toBe('ack_deadline');
    expect((await row(id)).stalled_at).toEqual(stalledAt);
    const fixed = await labelled(id);
    expect(await verifyPullSource(db, await row(id), fixed.reader)).toEqual({
      verified: true,
      failure: null,
    });
    expect((await sourceList(db, scope(tenant))).items[0]).toMatchObject({
      state: 'active',
      stall_reason: null,
      pull: { verification_failure: null },
    });
    expect((await row(id)).verified_at).not.toBeNull();
  });
  it('changes nothing when Google is unavailable', async () => {
    const { tenant, id } = await pullSource();
    const google = await labelled(id, { status: 503 });
    expect(await verifyPullSource(db, await row(id), google.reader)).toEqual({
      verified: false,
      failure: 'unavailable',
    });
    expect((await sourceList(db, scope(tenant))).items[0]).toMatchObject({
      state: 'awaiting_verification',
      stall_reason: null,
      pull: { verification_checked_at: null },
    });
  });
  it('records a confirmed sink filter for the current catalog in the owning workspace only', async () => {
    const { tenant, id } = await pullSource();
    const other = await fixtures.tenant();
    await db
      .updateTable('crawl_log_sources')
      .set({ filter_catalog_version: '0' })
      .where('id', '=', id)
      .execute();
    expect((await sourceList(db, scope(tenant))).items[0]!.pull!.filter_current).toBe(false);
    // Another workspace naming this source's UUID finds nothing to confirm.
    await expect(confirmSinkFilter(db, scope(other), other.userId, id)).rejects.toMatchObject({
      status: 404,
    });
    expect((await row(id)).filter_catalog_version).toBe('0');
    await confirmSinkFilter(db, scope(tenant), tenant.userId, id);
    expect((await sourceList(db, scope(tenant))).items[0]!.pull).toMatchObject({
      filter_catalog_version: '1',
      filter_current: true,
    });
  });
});

const GPTBOT = 'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)';
let messageSeq = 0;
/** A Pub/Sub message carrying one Cloud Logging entry, base64 as Pub/Sub delivers it. */
function message(entry: Record<string, unknown>) {
  messageSeq += 1;
  return {
    messageId: String(1000 + messageSeq),
    data: Buffer.from(JSON.stringify(entry)).toString('base64'),
  };
}
const lbEntry = (path: string, changes: Record<string, unknown> = {}) => ({
  insertId: 'insert-' + path,
  timestamp: new Date().toISOString(),
  resource: { type: 'http_load_balancer' },
  httpRequest: {
    requestMethod: 'GET',
    requestUrl: `https://acme.example${path}?session=secret#top`,
    status: 200,
    userAgent: GPTBOT,
    remoteIp: '192.0.2.4',
  },
  ...changes,
});
/** A verified pull source, its labelled Google and the pull executor bound to it. */
async function verifiedSource() {
  const { tenant, id } = await pullSource();
  const google = await labelled(id);
  await verifyPullSource(db, await row(id), google.reader);
  return { tenant, id, google, executor: crawlLogPull(() => google.reader) };
}
/** Queue the source's pull through the tick's scheduler and run the claimed row. */
async function runPull(
  tenant: Tenant,
  executor: ReturnType<typeof crawlLogPull>,
  now = new Date(Date.now() + 3600_000 * Math.random()),
) {
  await enqueueDuePulls(db, tenant.workspaceId, now, () => true);
  const [task] = await pullTasks(tenant.workspaceId);
  if (!task) throw new Error('No pull was queued');
  await executor(task, { db, maxAttempts: 3, checkCancelled: async () => {} });
}
/** The workspace's queued pulls, newest first. */
const pullTasks = (workspaceId: string) =>
  db
    .selectFrom('analytics_tasks')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('task_kind', '=', 'crawl_log_pull')
    .orderBy('created_at', 'desc')
    .execute();
const pullReceipts = (id: string) =>
  db
    .selectFrom('crawl_log_batches')
    .select(['lines_received', 'lines_matched', 'lines_rejected', 'lines_duplicate', 'drained'])
    .where('source_id', '=', id)
    .orderBy('received_at')
    .execute();
/** A receipt for pulled lines, as `pullReceipts` reads it. */
const batch = (received: number, matched: number, rejected = 0, duplicate = 0) => ({
  lines_received: received,
  lines_matched: matched,
  lines_rejected: rejected,
  lines_duplicate: duplicate,
  drained: false,
});
const DRAIN = { ...batch(0, 0), drained: true };

describe('pull task', () => {
  it('admits mapped requests, acknowledges after the commit and records the drain', async () => {
    const { tenant, id, google, executor } = await verifiedSource();
    google.state.messages.push(
      message(lbEntry('/guide')),
      message(lbEntry('/pricing', { resource: { type: 'cloud_run_revision' } })),
      message(lbEntry('/other', { resource: { type: 'gce_instance' } })),
      { messageId: '9999', data: '%%%' },
    );
    const committedAtAck: number[] = [];
    google.state.onAck = async () => {
      committedAtAck.push((await pullReceipts(id)).length);
    };
    await runPull(tenant, executor);
    expect(committedAtAck).toEqual([1]);
    expect(google.state.acked.sort()).toEqual(google.state.messages.map((m) => m.messageId).sort());
    expect(await pullReceipts(id)).toEqual([batch(4, 2, 2), DRAIN]);
    const paths = await db
      .selectFrom('bot_requests')
      .select('display_path')
      .where('source_id', '=', id)
      .orderBy('display_path')
      .execute();
    expect(paths).toEqual([{ display_path: '/guide' }, { display_path: '/pricing' }]);
    expect((await sourceList(db, scope(tenant))).items[0]).toMatchObject({
      state: 'active',
      connection: 'connected',
      pull: { last_drained_at: expect.any(String), last_pull_at: expect.any(String) },
    });
  });
  it('deduplicates a redelivery after a lost acknowledgement', async () => {
    const { tenant, id, google, executor } = await verifiedSource();
    google.state.messages.push(message(lbEntry('/a')), message(lbEntry('/b')));
    google.state.failing = ':acknowledge';
    google.state.status = 503;
    await runPull(tenant, executor);
    expect(google.state.acked).toEqual([]);
    // Redelivered alongside a new message, the batch has a new key; request IDs dedupe it.
    google.state.messages.push(message(lbEntry('/c')));
    google.state.status = 200;
    await runPull(tenant, executor);
    expect(google.state.acked).toHaveLength(3);
    expect(await pullReceipts(id)).toEqual([batch(2, 2), batch(3, 1, 0, 2), DRAIN]);
  });
  it('stalls on a refused pull and stops pulling until a check passes', async () => {
    const { tenant, id, google, executor } = await verifiedSource();
    google.state.failing = ':pull';
    google.state.status = 403;
    await runPull(tenant, executor);
    expect((await sourceList(db, scope(tenant))).items[0]).toMatchObject({
      state: 'stalled',
      stall_reason: 'verification_failed',
      pull: { verification_failure: 'permission_denied' },
    });
    const pulls = google.state.pulls;
    // Within the day, the tick holds the stalled source back.
    await enqueueDuePulls(db, tenant.workspaceId, new Date(Date.now() + 600_000), () => true);
    expect(await pullTasks(tenant.workspaceId)).toHaveLength(1);
    expect(google.state.pulls).toBe(pulls);
    expect(await pullReceipts(id)).toEqual([]);
  });
  it('does not pull when the due ownership check cannot reach Google', async () => {
    const { tenant, id, google, executor } = await verifiedSource();
    await db
      .updateTable('crawl_log_sources')
      .set({ verification_checked_at: new Date(Date.now() - 2 * 86400000) })
      .where('id', '=', id)
      .execute();
    google.state.messages.push(message(lbEntry('/held')));
    google.state.failing = 'get';
    google.state.status = 503;
    await runPull(tenant, executor);
    expect(google.state.pulls).toBe(0);
    expect(await pullReceipts(id)).toEqual([]);
    expect((await row(id)).stall_reason).toBeNull();
  });
  it('retries a held source daily even before its first pull', async () => {
    const { tenant, id } = await verifiedSource();
    await db
      .updateTable('crawl_log_sources')
      .set({
        stall_reason: 'verification_failed',
        stalled_at: new Date(),
        verification_failure: 'label_mismatch',
        last_pull_at: null,
      })
      .where('id', '=', id)
      .execute();
    await enqueueDuePulls(db, tenant.workspaceId, new Date(), () => true);
    expect(await pullTasks(tenant.workspaceId)).toHaveLength(1);
  });
  it('schedules verified sources only, once per interval', async () => {
    const unverified = await pullSource();
    const { tenant } = await verifiedSource();
    const at = new Date('2030-01-01T00:01:00Z');
    for (const workspace of [unverified.tenant, tenant])
      for (const now of [at, new Date(at.getTime() + 60_000)])
        await enqueueDuePulls(db, workspace.workspaceId, now, () => true);
    expect(await pullTasks(unverified.tenant.workspaceId)).toEqual([]);
    expect(await pullTasks(tenant.workspaceId)).toHaveLength(1);
  });
  it('leases a pull for its own longer TTL', async () => {
    const tenant = await fixtures.tenant();
    const queue = new TaskQueue(db, {
      leaseTtlSeconds: 120,
      leaseTtlSecondsByKind: { crawl_log_pull: 300 },
    });
    for (const kind of ['crawl_log_pull', 'crawl_log_rollup_refresh'])
      await enqueueTask(db, {
        workspaceId: tenant.workspaceId,
        projectId: tenant.projectId,
        kind,
        payload: {},
        keyParts: [tenant.projectId, 'lease'],
        maxAttempts: 1,
      });
    const claimed = await queue.claim({
      owner: 'lease-test',
      kinds: ['crawl_log_pull', 'crawl_log_rollup_refresh'],
      limit: 2,
      scope: {
        workspaceId: tenant.workspaceId,
        taskIds: (
          await db
            .selectFrom('analytics_tasks')
            .select('id')
            .where('workspace_id', '=', tenant.workspaceId)
            .execute()
        ).map((t) => t.id),
      },
    });
    const leases = Object.fromEntries(
      claimed.map((t) => [
        t.task_kind,
        Math.round((t.lease_expires_at!.getTime() - t.heartbeat_at!.getTime()) / 1000),
      ]),
    );
    expect(leases).toEqual({ crawl_log_pull: 300, crawl_log_rollup_refresh: 120 });
  });
});

describe('pull coverage', () => {
  const day = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const start = new Date(day + 'T00:00:00Z');
  /** Drains every `gap` minutes across the day, then one `settle` minutes after it closed. */
  async function coverageFor(
    options: {
      gap?: number;
      settle?: number | null;
      rate?: number;
      catalog?: string;
      verifiedLateMinutes?: number;
    } = {},
  ) {
    const { tenant, id } = await pullSource(undefined, options.rate);
    await db
      .updateTable('crawl_log_sources')
      .set({
        created_at: new Date(start.getTime() - 3600_000),
        verified_at: new Date(start.getTime() + (options.verifiedLateMinutes ?? 0) * 60000),
      })
      .where('id', '=', id)
      .execute();
    const seed = await ingest(db, await row(id), Buffer.alloc(0), {
      now: start,
      key: 'seed',
      drained: true,
    });
    const gap = options.gap ?? 29;
    const times = Array.from(
      { length: Math.floor((24 * 60) / gap) },
      (_, i) => start.getTime() + (i + 1) * gap * 60000,
    );
    const settle = options.settle === undefined ? 16 : options.settle;
    if (settle !== null) times.push(start.getTime() + 86400000 + settle * 60000);
    await db
      .insertInto('crawl_log_batches')
      .values(
        times.map((t, i) => ({
          ...seed,
          id: crypto.randomUUID(),
          idempotency_key: 'drain-' + i,
          received_at: new Date(t),
          catalog_version: options.catalog ?? seed.catalog_version,
        })),
      )
      .execute();
    await refreshCrawlLogs(db, scope(tenant), new Date(), [day]);
    return db
      .selectFrom('crawl_log_coverage_daily')
      .select(['coverage', 'reason'])
      .where('source_id', '=', id)
      .where('reporting_date', '=', start)
      .executeTakeFirstOrThrow();
  }
  it.each([
    [{}, 'complete', 'drained_unsampled_current_filter'],
    [{ gap: 31 }, 'partial', 'pull_drain_gap'],
    [{ settle: 14 }, 'partial', 'pull_awaiting_settle'],
    [{ settle: null }, 'partial', 'pull_awaiting_settle'],
    [{ rate: 0.5 }, 'partial', 'pull_sampled'],
    [{ catalog: '0' }, 'partial', 'sink_filter_outdated'],
    // Verified ten minutes after midnight: the drain gap alone would not notice.
    [{ verifiedLateMinutes: 10 }, 'partial', 'pull_not_live_all_day'],
  ] as const)('judges drains %j as %s (%s)', async (options, coverage, reason) => {
    expect(await coverageFor(options)).toEqual({ coverage, reason });
  });
});
