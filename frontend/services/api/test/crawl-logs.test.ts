import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { sql } from 'kysely';
import { createApp } from '../src/app.ts';
import { TEST_SESSION_COOKIE, testConfig, testDatabase, sessionToken } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';
import { crawlLogs } from '../src/config/crawl-logs.ts';
import { createSource, mutateSource } from '../src/crawl-logs/sources.ts';
import { ingest, decodedBody } from '../src/crawl-logs/ingest.ts';
import { createUpload, completeUpload } from '../src/crawl-logs/uploads.ts';
import { refreshCrawlLogs } from '../src/crawl-logs/rollup.ts';
import {
  abandonUploads,
  botRequestRetentionSweep,
  botIpRangeRefresh,
  crawlLogTick,
} from '../src/crawl-logs/maintenance.ts';
import { crawlers } from '../src/config/crawlers.ts';
import { crawlSummary, activityPage, crawlerPage } from '../src/crawl-logs/reads.ts';
import { pagesRead } from '../src/crawl-logs/pages.ts';
import { dispatchTool } from '../src/mcp/tools.ts';
import { verifyBot } from '../src/crawl-logs/identity.ts';
import { sourceList } from '../src/crawl-logs/source-reads.ts';
import {
  logLines,
  parseLogLine,
  UnsupportedLogFormat,
} from '@citeladder/contracts/crawl-log-format';

const config = testConfig(),
  db = testDatabase(config),
  fixtures = new VisibilityFixtures(db),
  app = createApp(config, db);
const original = { ...crawlLogs };
const snapshotIds: string[] = [];
const now = new Date();
const scope = (t: Tenant) => ({ workspaceId: t.workspaceId, projectId: t.projectId });
const event = (changes: Record<string, unknown> = {}) => ({
  timestamp: now.toISOString(),
  host: 'acme.example',
  path: '/products/guide.pdf?secret=drop#fragment',
  method: 'GET',
  status: 200,
  user_agent: 'GPTBot/1.0 private-agent',
  client_ip: '192.0.2.2',
  ...changes,
});
async function setup(
  kind: 'custom' | 'upload' | 'cloudflare_worker' | 'cloudflare_logpush' = 'custom',
) {
  const tenant = await fixtures.tenant();
  const result = await createSource(db, scope(tenant), tenant.userId, {
    setup: kind,
    origin: 'https://acme.example',
    format: 'ndjson',
  });
  const source = await db
    .selectFrom('crawl_log_sources')
    .selectAll()
    .where('id', '=', result.id)
    .executeTakeFirstOrThrow();
  return { tenant, source, token: result.token! };
}
const body = (...rows: Record<string, unknown>[]) =>
  Buffer.from(rows.map((r) => JSON.stringify(r)).join('\n'));
const send = (id: string, token: string, payload: Buffer, key = randomUUID()) =>
  app.request('/v1/crawl-logs/ingest/' + id, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + token,
      'content-type': 'application/x-ndjson',
      'idempotency-key': key,
    },
    body: new Uint8Array(payload),
  });
beforeAll(() => {
  crawlLogs.ingestion_enabled = true;
});
afterAll(async () => {
  Object.assign(crawlLogs, original);
  await fixtures.cleanup();
  if (snapshotIds.length)
    await db.deleteFrom('bot_ip_range_snapshots').where('id', 'in', snapshotIds).execute();
  await db.destroy();
});

describe('bounded formats', () => {
  it('refuses every workspace with the kill switch off and resumes with it on', async () => {
    const { tenant, source, token } = await setup();
    crawlLogs.ingestion_enabled = false;
    try {
      expect((await sourceList(db, scope(tenant))).availability).toBe('disabled');
      const refused = await send(source.id, token, body(event()));
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ error: { code: 'crawl_logs_disabled' } });
    } finally {
      crawlLogs.ingestion_enabled = true;
    }
    expect((await send(source.id, token, body(event()))).status).toBe(202);
  });
  it('parses NDJSON, array and Combined while refusing CLF and missing identification fields', () => {
    const mapping = crawlLogs.presets.custom_ndjson!;
    expect(parseLogLine(JSON.stringify(event()), 'ndjson', mapping)?.path).toContain('/products/');
    expect(logLines(JSON.stringify([event(), event()]), 'json_array', 2)).toHaveLength(2);
    const line =
      '192.0.2.2 - - [03/Oct/2026:10:00:00 +0000] "GET /robots.txt HTTP/1.1" 403 10 "-" "GPTBot/1.0"';
    expect(parseLogLine(line, 'combined', mapping)).toMatchObject({
      timestamp: '2026-10-03T10:00:00+00:00',
      status: 403,
      user_agent: 'GPTBot/1.0',
    });
    expect(() =>
      parseLogLine(
        '192.0.2.2 - - [03/Oct/2026:10:00:00 +0000] "GET / HTTP/1.1" 200 10',
        'combined',
        mapping,
      ),
    ).toThrow(UnsupportedLogFormat);
    expect(() => parseLogLine('{"path":"/"}', 'ndjson', mapping)).toThrow(UnsupportedLogFormat);
    expect(() => logLines('a\nb', 'ndjson', 1)).toThrow(RangeError);
    expect(() =>
      decodedBody(gzipSync(Buffer.alloc(crawlLogs.max_batch_bytes + 1)), 'gzip'),
    ).toThrow(/too large/);
    expect(() => decodedBody(Buffer.from([255]), undefined)).toThrow(/UTF-8/);
  });
});
/** One CloudFront standard logging (v2) JSON record, as Firehose delivers it. */
const cloudfront = (changes: Record<string, unknown> = {}) => ({
  'timestamp(ms)': String(now.getTime()),
  date: now.toISOString().slice(0, 10),
  time: now.toISOString().slice(11, 19),
  'c-ip': '192.0.2.2',
  'sc-status': '200',
  'cs-method': 'GET',
  'cs-uri-stem': '/products/guide',
  'x-edge-request-id': 'edge-request-1',
  'x-host-header': 'acme.example',
  'cs(Host)': 'd111111abcdef8.cloudfront.net',
  'cs(User-Agent)':
    'Mozilla/5.0%20AppleWebKit/537.36%20(KHTML,%20like%20Gecko;%20compatible;%20GPTBot/1.2;%20+https://openai.com/gptbot)',
  ...changes,
});
describe('CloudFront v2 preset', () => {
  const preset = crawlLogs.presets.cloudfront_v2_json!;
  it('reads string epoch milliseconds, the viewer host and the URL-decoded user agent', () => {
    expect(parseLogLine(JSON.stringify(cloudfront()), 'ndjson', preset)).toEqual({
      timestamp: now.toISOString(),
      host: 'acme.example',
      path: '/products/guide',
      method: 'GET',
      status: 200,
      user_agent:
        'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
      client_ip: '192.0.2.2',
      request_id: 'edge-request-1',
    });
  });
  it('treats "-" as absent and falls back to the UTC date and time', () => {
    const line = JSON.stringify(
      cloudfront({ 'timestamp(ms)': '-', 'c-ip': '-', 'x-edge-request-id': '-' }),
    );
    expect(parseLogLine(line, 'ndjson', preset)).toMatchObject({
      timestamp: now.toISOString().slice(0, 19) + 'Z',
      client_ip: null,
      request_id: null,
    });
    expect(
      parseLogLine(JSON.stringify(cloudfront({ 'sc-status': '-' })), 'ndjson', preset),
    ).toBeNull();
    expect(() =>
      parseLogLine(JSON.stringify(cloudfront({ 'cs(User-Agent)': '-' })), 'ndjson', preset),
    ).toThrow(UnsupportedLogFormat);
  });
  it('refuses a calendar-impossible fallback date instead of moving it to another day', () => {
    const line = (date: string) =>
      JSON.stringify(cloudfront({ 'timestamp(ms)': '-', date, time: '10:00:00' }));
    expect(parseLogLine(line('2026-02-28'), 'ndjson', preset)?.timestamp).toBe(
      '2026-02-28T10:00:00Z',
    );
    expect(() => parseLogLine(line('2026-02-31'), 'ndjson', preset)).toThrow(UnsupportedLogFormat);
  });
  it('keeps an undecodable user agent as sent', () => {
    expect(
      parseLogLine(
        JSON.stringify(cloudfront({ 'cs(User-Agent)': 'GPTBot%E0%A4' })),
        'ndjson',
        preset,
      )?.user_agent,
    ).toBe('GPTBot%E0%A4');
  });
});
describe('sanitized durable admission', () => {
  it('requires distinct heartbeat keys and rejects a malformed line without losing the batch', async () => {
    const { source } = await setup();
    await expect(ingest(db, source, Buffer.alloc(0), {})).rejects.toThrow(/idempotency key/);
    const first = await ingest(db, source, Buffer.alloc(0), { key: 'heartbeat-1', now });
    const later = new Date(now.getTime() + 60000);
    const second = await ingest(db, source, Buffer.alloc(0), { key: 'heartbeat-2', now: later });
    expect(second.id).not.toBe(first.id);
    expect(second.received_at).toEqual(later);
    expect((await ingest(db, source, Buffer.alloc(0), { key: 'heartbeat-2' })).id).toBe(second.id);
    const mixed = await ingest(db, source, body(event(), { path: '/missing-fields' }), {
      key: 'mixed',
    });
    expect(mixed).toMatchObject({
      status: 'accepted',
      lines_received: 2,
      lines_matched: 1,
      lines_rejected: 1,
    });
    // An identifiable line with an invalid status proves the format, though nothing is admitted.
    const invalid = await ingest(
      db,
      source,
      body(event({ status: 'not-a-status' }), { path: '/missing-fields' }),
      { key: 'invalid-and-missing' },
    );
    expect(invalid).toMatchObject({ status: 'accepted', lines_matched: 0, lines_rejected: 2 });
    await expect(
      ingest(db, source, body({ path: '/a' }, { path: '/b' }), { key: 'unsupported' }),
    ).rejects.toThrow(/crawler identification/);
    const rejected = await db
      .selectFrom('crawl_log_batches')
      .selectAll()
      .where('source_id', '=', source.id)
      .where('idempotency_key', '=', 'unsupported')
      .executeTakeFirstOrThrow();
    expect(rejected).toMatchObject({
      status: 'unsupported_format',
      lines_received: 2,
      lines_parsed: 0,
      lines_rejected: 2,
      lines_matched: 0,
      first_line_at: null,
    });
    expect(
      await db.selectFrom('bot_requests').select('id').where('source_id', '=', source.id).execute(),
    ).toHaveLength(1);
  });
  it('admits a multi-statement batch atomically and coalesces affected reporting days', async () => {
    const { tenant, source } = await setup();
    const count = crawlLogs.insert_rows_per_statement + 1;
    const receipt = await ingest(
      db,
      source,
      body(...Array.from({ length: count }, (_, i) => event({ path: '/chunk/' + i }))),
      {},
    );
    expect(receipt.lines_matched).toBe(count);
    const older = new Date(now.getTime() - 5 * 86400000);
    await ingest(db, source, body(event({ timestamp: older.toISOString() })), {});
    const tasks = await db
      .selectFrom('analytics_tasks')
      .selectAll()
      .where('workspace_id', '=', tenant.workspaceId)
      .where('task_kind', '=', 'crawl_log_rollup_refresh')
      .execute();
    expect(tasks).toHaveLength(1);
    const dates = (tasks[0]!.payload as { reporting_dates: string[] }).reporting_dates;
    expect(dates).toContain(older.toISOString().slice(0, 10));
    await refreshCrawlLogs(db, scope(tenant), now, dates);
    const total = await db
      .selectFrom('bot_activity_daily')
      .select(sql<number>`sum(requests)::integer`.as('count'))
      .where('workspace_id', '=', tenant.workspaceId)
      .executeTakeFirstOrThrow();
    expect(total.count).toBe(count + 1);
    const ids = await db
      .selectFrom('bot_activity_daily')
      .select('id')
      .where('workspace_id', '=', tenant.workspaceId)
      .where('reporting_date', '=', new Date(older.toISOString().slice(0, 10) + 'T00:00:00Z'))
      .execute();
    await refreshCrawlLogs(db, scope(tenant), now, [now.toISOString().slice(0, 10)]);
    expect(
      await db
        .selectFrom('bot_activity_daily')
        .select('id')
        .where('workspace_id', '=', tenant.workspaceId)
        .where('reporting_date', '=', new Date(older.toISOString().slice(0, 10) + 'T00:00:00Z'))
        .execute(),
    ).toEqual(ids);
  });
  it('retains unsupported diagnostics and accepts Logpush validation without claiming coverage', async () => {
    const custom = await setup();
    const invalid = Buffer.from('{"path":"/without-identification"}');
    await expect(ingest(db, custom.source, invalid, {})).rejects.toThrow(/crawler identification/);
    const saved = await db
      .selectFrom('crawl_log_batches')
      .selectAll()
      .where('source_id', '=', custom.source.id)
      .executeTakeFirstOrThrow();
    expect(saved).toMatchObject({
      status: 'unsupported_format',
      missing_fields: ['timestamp', 'user_agent'],
      heartbeat: false,
    });
    expect(saved.idempotency_key).toBe(createHash('sha256').update(invalid).digest('hex'));
    await expect(ingest(db, custom.source, invalid, {})).rejects.toThrow(/crawler identification/);
    expect(
      await db
        .selectFrom('crawl_log_batches')
        .select('id')
        .where('source_id', '=', custom.source.id)
        .execute(),
    ).toHaveLength(1);
    const cloudflare = await setup('cloudflare_logpush');
    const probe = await send(
      cloudflare.source.id,
      cloudflare.token,
      gzipSync(Buffer.from('{"content":"tests"}')),
    );
    expect(probe.status).toBe(202);
    await refreshCrawlLogs(db, scope(cloudflare.tenant));
    expect(await crawlSummary(db, scope(cloudflare.tenant))).toMatchObject({
      coverage: 'unknown',
      requests: null,
      connection: 'awaiting_data',
    });
    // Crawl admission has its own authenticated bound, above the ordinary API limit.
    const large = await send(
      custom.source.id,
      custom.token,
      body(event({ ignored: 'x'.repeat(3 * 1024 * 1024) })),
    );
    expect(large.status).toBe(202);
    expect(await large.json()).toMatchObject({ lines_rejected: 1, lines_matched: 0 });
  });
  it('discards unmatched/out-of-scope/bounded lines, retains public UUID identity and redacts secrets', async () => {
    const { tenant, source } = await setup();
    const a = randomUUID(),
      b = randomUUID();
    const receipt = await ingest(
      db,
      source,
      body(
        event({ user_agent: 'Mozilla/5.0' }),
        event({ host: 'other.example' }),
        event({ path: '//other.example/escape' }),
        event({ path: '/reset/very-private-token' }),
        event({ path: '/products/' + a }),
        event({ path: '/products/' + b }),
        event({ path: '/' + 'x'.repeat(crawlLogs.max_line_bytes) }),
        event({ timestamp: new Date(now.getTime() + 2 * 3600000).toISOString() }),
        event({ timestamp: new Date(now.getTime() - 81 * 86400000).toISOString() }),
      ),
      { now },
    );
    expect(receipt).toMatchObject({
      lines_matched: 3,
      lines_unmatched: 1,
      lines_out_of_scope: 2,
      lines_rejected: 3,
    });
    const rows = await db
      .selectFrom('bot_requests')
      .selectAll()
      .where('workspace_id', '=', tenant.workspaceId)
      .execute();
    expect(rows.find((r) => r.identity === 'non_joinable')).toMatchObject({
      display_path: '/reset/[redacted]',
      url_hash: null,
      identity_reason: 'redacted_secret',
    });
    expect(new Set(rows.filter((r) => r.identity === 'exact').map((r) => r.url_hash)).size).toBe(2);
    const persisted = JSON.stringify(rows);
    for (const secret of ['192.0.2.2', 'very-private-token', 'private-agent', 'secret=drop'])
      expect(persisted).not.toContain(secret);
    const tasks = await db
      .selectFrom('analytics_tasks')
      .selectAll()
      .where('workspace_id', '=', tenant.workspaceId)
      .where('task_kind', '=', 'crawl_log_rollup_refresh')
      .execute();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ task_kind: 'crawl_log_rollup_refresh', status: 'queued' });
    expect(tasks[0]!.available_at.getTime()).toBeGreaterThan(now.getTime());
  });
  it('returns the original receipt for replay and deduplicates request IDs and byte-identical lines', async () => {
    const { tenant, source, token } = await setup();
    const key = randomUUID(),
      payload = body(
        event({ request_id: 'ray-123' }),
        event({ path: '/repeat' }),
        event({ path: '/repeat' }),
      );
    const first = await send(source.id, token, payload, key),
      second = await send(source.id, token, payload, key);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(await second.json()).toEqual(await first.json());
    const third = await ingest(db, source, payload, { key: randomUUID() });
    expect(third).toMatchObject({ lines_matched: 0, lines_duplicate: 3 });
    expect(
      await db
        .selectFrom('bot_requests')
        .select('id')
        .where('workspace_id', '=', tenant.workspaceId)
        .execute(),
    ).toHaveLength(2);
  });
  it('answers a retried key from its stored receipt without decoding the new body', async () => {
    const { source, token } = await setup();
    const key = randomUUID();
    const accepted = await send(source.id, token, body(event()), key);
    expect(accepted.status).toBe(202);
    const retried = await app.request('/v1/crawl-logs/ingest/' + source.id, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-encoding': 'gzip',
        'idempotency-key': key,
      },
      body: new Uint8Array(Buffer.from('not a gzip stream')),
    });
    expect(retried.status).toBe(202);
    expect(await retried.json()).toEqual(await accepted.json());
  });
  it('refuses wrong, rotated and revoked tokens and never permits a token from another project', async () => {
    const a = await setup(),
      b = await setup();
    expect((await send(b.source.id, a.token, body(event()))).status).toBe(401);
    expect((await send(a.source.id, 'wrong', body(event()))).status).toBe(401);
    const rotated = await mutateSource(db, scope(a.tenant), a.tenant.userId, a.source.id, 'rotate');
    expect((await send(a.source.id, a.token, body(event()))).status).toBe(401);
    expect((await send(a.source.id, rotated.token!, body(event()))).status).toBe(202);
    await mutateSource(db, scope(a.tenant), a.tenant.userId, a.source.id, 'revoke');
    const revokedAt = () =>
      db
        .selectFrom('crawl_log_sources')
        .select('revoked_at')
        .where('id', '=', a.source.id)
        .executeTakeFirstOrThrow();
    const first = await revokedAt();
    await mutateSource(db, scope(a.tenant), a.tenant.userId, a.source.id, 'revoke');
    // A repeated revoke keeps the original coverage boundary.
    expect(await revokedAt()).toEqual(first);
    expect((await send(a.source.id, rotated.token!, body(event()))).status).toBe(409);
    expect(
      await db
        .selectFrom('bot_requests')
        .select('id')
        .where('workspace_id', '=', b.tenant.workspaceId)
        .execute(),
    ).toHaveLength(0);
  });
  it('limits batches with Retry-After and rejects gzip bombs over HTTP', async () => {
    const a = await setup();
    const old = crawlLogs.batches_per_source_per_hour;
    crawlLogs.batches_per_source_per_hour = 1;
    try {
      const key = randomUUID();
      const accepted = await send(a.source.id, a.token, Buffer.alloc(0), key);
      expect(accepted.status).toBe(202);
      const refused = await send(a.source.id, a.token, Buffer.alloc(0));
      expect(refused.status).toBe(429);
      expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
      // A retried accepted key still receives its stored receipt after the quota is spent.
      const replay = await send(a.source.id, a.token, Buffer.alloc(0), key);
      expect(replay.status).toBe(202);
      const receiptId = async (response: Response) =>
        ((await response.json()) as { id: string }).id;
      expect(await receiptId(replay)).toBe(await receiptId(accepted));
      // An upload retry of an accepted sequence is the same replay.
      const u = await setup('upload');
      const upload = await createUpload(
        db,
        scope(u.tenant),
        u.source.id,
        { filename: 'retry.ndjson', size_bytes: 10 },
        u.tenant.userId,
      );
      const cookie =
        TEST_SESSION_COOKIE + '=' + (await sessionToken({ sub: u.tenant.userId, ver: 0 }));
      const batch = () =>
        app.request(
          `/api/v1/projects/${u.tenant.projectId}/crawl-logs/sources/${u.source.id}/uploads/${upload.id}/batches`,
          {
            method: 'POST',
            headers: { cookie, 'content-type': 'application/json' },
            body: JSON.stringify({ seq: 0, lines: [JSON.stringify(event())] }),
          },
        );
      expect((await batch()).status).toBe(200);
      expect((await batch()).status).toBe(200);
    } finally {
      crawlLogs.batches_per_source_per_hour = old;
    }
    const b = await setup();
    const bomb = await app.request('/v1/crawl-logs/ingest/' + b.source.id, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + b.token, 'content-encoding': 'gzip' },
      body: new Uint8Array(gzipSync(Buffer.alloc(crawlLogs.max_batch_bytes + 1))),
    });
    expect(bomb.status).toBe(413);
  });
  it('requires Owner/Admin and workspace authorization for source mutations', async () => {
    const a = await setup(),
      b = await setup();
    const cookie =
      TEST_SESSION_COOKIE + '=' + (await sessionToken({ sub: b.tenant.userId, ver: 0 }));
    expect(
      (
        await app.request('/api/v1/projects/' + a.tenant.projectId + '/crawl-logs/sources', {
          headers: { cookie },
        })
      ).status,
    ).toBe(404);
    const member = await fixtures.user();
    await fixtures.member(a.tenant.workspaceId, member, 'member');
    const memberCookie = TEST_SESSION_COOKIE + '=' + (await sessionToken({ sub: member, ver: 0 }));
    expect(
      (
        await app.request(
          '/api/v1/projects/' +
            a.tenant.projectId +
            '/crawl-logs/sources/' +
            a.source.id +
            '/rotate',
          { method: 'POST', headers: { cookie: memberCookie } },
        )
      ).status,
    ).toBe(403);
    await expect(
      createSource(db, scope(a.tenant), a.tenant.userId, {
        setup: 'custom',
        origin: 'https://acme.example',
        format: 'ndjson',
      }),
    ).rejects.toThrow(/active live source/);
  });
});
describe('verification vocabulary', () => {
  it('records every reason and both verification bases using IPv4 and IPv6 ranges', () => {
    const bot = crawlers.bots.find((b) => b.bot_id === 'openai_gptbot')!;
    const snapshot = {
      id: randomUUID(),
      bot_id: bot.bot_id,
      cidrs: ['192.0.2.0/24', '2001:db8::/32'],
      content_hash: 'test',
      source_url: 'https://example.test',
      fetched_at: now,
      status: 'succeeded',
    };
    expect(verifyBot(bot, null, snapshot, now, now).verification_reason).toBe('missing_ip');
    expect(verifyBot(bot, '192.0.2.1:443', snapshot, now, now)).toMatchObject({
      verification: 'unverifiable',
      verification_reason: 'invalid_ip',
    });
    expect(
      verifyBot({ ...bot, verification: { method: 'none' } }, '192.0.2.1', undefined, now, now)
        .verification_reason,
    ).toBe('no_published_ranges');
    expect(verifyBot(bot, '192.0.2.1', undefined, now, now).verification_reason).toBe(
      'no_snapshot',
    );
    expect(
      verifyBot(
        bot,
        '192.0.2.1',
        { ...snapshot, fetched_at: new Date(now.getTime() - 73 * 3600000) },
        now,
        now,
      ).verification_reason,
    ).toBe('stale_snapshot');
    expect(verifyBot(bot, '203.0.113.1', snapshot, now, now)).toMatchObject({
      verification: 'failed_verification',
      verification_reason: 'ip_outside_ranges',
    });
    expect(verifyBot(bot, '192.0.2.1', snapshot, now, now)).toMatchObject({
      verification: 'verified',
      verification_basis: 'contemporaneous',
    });
    expect(
      verifyBot(bot, '2001:db8::1', snapshot, new Date(now.getTime() - 48 * 3600000), now),
    ).toMatchObject({ verification: 'verified', verification_basis: 'later_snapshot' });
    // Ranges published later cannot prove an older request came from elsewhere.
    expect(
      verifyBot(bot, '203.0.113.1', snapshot, new Date(now.getTime() - 48 * 3600000), now),
    ).toMatchObject({
      verification: 'unverifiable',
      verification_reason: 'later_snapshot_mismatch',
    });
    expect(
      verifyBot(
        bot,
        '192.0.2.1',
        { ...snapshot, fetched_at: new Date(now.getTime() - 48 * 3600000) },
        now,
        now,
      ),
    ).toMatchObject({ verification: 'unverifiable', verification_reason: 'stale_snapshot' });
  });
});
describe('uploads, coverage and serialized recomputation', () => {
  it('derives complete days from server reporting midnights', async () => {
    const { tenant, source } = await setup('upload');
    await db
      .updateTable('crawl_log_states')
      .set({ reporting_timezone: 'Asia/Kolkata' })
      .where('workspace_id', '=', tenant.workspaceId)
      .where('project_id', '=', tenant.projectId)
      .execute();
    const upload = await createUpload(
      db,
      scope(tenant),
      source.id,
      { filename: 'local-days.log', size_bytes: 100 },
      tenant.userId,
    );
    const firstDay = new Date(now.getTime() - 3 * 86400000).toISOString().slice(0, 10);
    const middleDay = new Date(now.getTime() - 2 * 86400000).toISOString().slice(0, 10);
    const lastDay = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
    const completed = await completeUpload(
      db,
      scope(tenant),
      source.id,
      upload.id,
      {
        scanned_lines: 3,
        first_line_at: firstDay + 'T12:00:00Z',
        last_line_at: lastDay + 'T12:00:00Z',
        scanned_dates: [firstDay, middleDay, lastDay],
      },
      tenant.userId,
    );
    expect(completed.scanned_dates).toEqual([
      { date: firstDay, complete: false },
      { date: middleDay, complete: true },
      { date: lastDay, complete: false },
    ]);
    await refreshCrawlLogs(db, scope(tenant));
    expect(
      await crawlSummary(db, scope(tenant), { start_date: middleDay, end_date: middleDay }),
    ).toMatchObject({
      coverage: 'declared_complete',
      requests: 0,
      reporting_timezone: 'Asia/Kolkata',
    });
    expect(
      await crawlSummary(db, scope(tenant), { start_date: firstDay, end_date: firstDay }),
    ).toMatchObject({ coverage: 'partial', requests: null });
  });
  it('publishes bounded keys for long multibyte redacted folders', async () => {
    const { tenant, source } = await setup();
    await ingest(
      db,
      source,
      body(event({ path: '/' + '界'.repeat(1800) + '/reset/private-token' })),
      {},
    );
    await refreshCrawlLogs(db, scope(tenant));
    const row = await db
      .selectFrom('bot_activity_daily')
      .select(['identity_key', 'requests', 'url_hash'])
      .where('workspace_id', '=', tenant.workspaceId)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ requests: 1, url_hash: null });
    expect(row.identity_key).toMatch(/^[a-f0-9]{64}$/);
  });
  it('a completed zero-match file scan excludes a different source on its reporting day', async () => {
    const { tenant, source } = await setup('upload');
    const upload = await createUpload(
      db,
      scope(tenant),
      source.id,
      { filename: 'zero.log', size_bytes: 100 },
      tenant.userId,
    );
    const day = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
    await completeUpload(
      db,
      scope(tenant),
      source.id,
      upload.id,
      {
        scanned_lines: 2,
        first_line_at: day + 'T00:00:00Z',
        last_line_at: day + 'T23:59:59Z',
        scanned_dates: [day],
      },
      tenant.userId,
    );
    await refreshCrawlLogs(db, scope(tenant));
    expect(await crawlSummary(db, scope(tenant), { start_date: day, end_date: day })).toMatchObject(
      {
        connection: 'connected',
        coverage: 'declared_complete',
        requests: 0,
      },
    );
    const live = await createSource(db, scope(tenant), tenant.userId, {
      setup: 'custom',
      origin: source.origin,
      format: 'ndjson',
    });
    const liveSource = await db
      .selectFrom('crawl_log_sources')
      .selectAll()
      .where('id', '=', live.id)
      .executeTakeFirstOrThrow();
    const receipt = await ingest(
      db,
      liveSource,
      body(event({ timestamp: day + 'T12:00:00Z' })),
      {},
    );
    expect(receipt).toMatchObject({ lines_matched: 0, lines_overlapping: 1 });
    expect(
      await db
        .selectFrom('bot_requests')
        .select('id')
        .where('workspace_id', '=', tenant.workspaceId)
        .execute(),
    ).toHaveLength(0);
    // A second file spanning that day completes and declares only the days no other source owns.
    const backfill = await createSource(db, scope(tenant), tenant.userId, {
      setup: 'upload',
      origin: source.origin,
      format: 'ndjson',
    });
    const second = await createUpload(
      db,
      scope(tenant),
      backfill.id,
      { filename: 'backfill.log', size_bytes: 100 },
      tenant.userId,
    );
    const before = new Date(Date.parse(day) - 86400000).toISOString().slice(0, 10);
    const completed = await completeUpload(
      db,
      scope(tenant),
      backfill.id,
      second.id,
      {
        scanned_lines: 2,
        first_line_at: before + 'T00:00:00Z',
        last_line_at: day + 'T23:59:59Z',
        scanned_dates: [before, day],
      },
      tenant.userId,
    );
    expect(completed).toMatchObject({
      status: 'completed',
      scanned_dates: [{ date: before, complete: true }],
    });
  });
  it('resumes/replays batches, re-filters client evidence and records a zero-match client scan', async () => {
    const { tenant, source } = await setup('upload');
    const upload = await createUpload(
      db,
      scope(tenant),
      source.id,
      { filename: 'logs.json', size_bytes: 100 },
      tenant.userId,
    );
    const options = { uploadId: upload.id, seq: 0, key: upload.id + ':0' };
    const first = await ingest(db, source, body(event({ user_agent: 'unmatched' })), options);
    expect(first.lines_unmatched).toBe(1);
    expect((await ingest(db, source, body(event({ user_agent: 'unmatched' })), options)).id).toBe(
      first.id,
    );
    const day = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
    await completeUpload(
      db,
      scope(tenant),
      source.id,
      upload.id,
      {
        scanned_lines: 100,
        first_line_at: day + 'T00:00:00Z',
        last_line_at: day + 'T23:59:59Z',
        scanned_dates: [day],
      },
      tenant.userId,
    );
    await refreshCrawlLogs(db, scope(tenant));
    const coverage = await db
      .selectFrom('crawl_log_coverage_daily')
      .select(['coverage', 'reason'])
      .where('source_id', '=', source.id)
      .where('reporting_date', '=', new Date(day + 'T00:00:00Z'))
      .executeTakeFirstOrThrow();
    expect(coverage).toEqual({ coverage: 'declared_complete', reason: 'client_reported' });
    expect(
      (
        await db
          .selectFrom('crawl_log_uploads')
          .select('last_ack_seq')
          .where('id', '=', upload.id)
          .executeTakeFirstOrThrow()
      ).last_ack_seq,
    ).toBe(0);
  });
  it('counts cross-source overlap, preserves request-ID uniqueness and abandons stale open uploads', async () => {
    const { tenant, source } = await setup();
    expect(await ingest(db, source, body(event({ request_id: 'shared-ray' })), {})).toMatchObject({
      lines_received: 1,
      lines_parsed: 1,
      lines_matched: 1,
      lines_rejected: 0,
      lines_unmatched: 0,
      lines_out_of_scope: 0,
      lines_overlapping: 0,
      lines_duplicate: 0,
    });
    const result = await createSource(db, scope(tenant), tenant.userId, {
      setup: 'upload',
      origin: 'https://acme.example',
      format: 'ndjson',
    });
    const uploadSource = await db
      .selectFrom('crawl_log_sources')
      .selectAll()
      .where('id', '=', result.id)
      .executeTakeFirstOrThrow();
    const upload = await createUpload(
      db,
      scope(tenant),
      result.id,
      { filename: 'backfill', size_bytes: 100 },
      tenant.userId,
    );
    const receipt = await ingest(
      db,
      uploadSource,
      body(event({ request_id: 'shared-ray' }), event({ path: '/overlap' })),
      { uploadId: upload.id, seq: 0, key: upload.id + ':0' },
    );
    expect(receipt.lines_overlapping).toBe(2);
    const replay = await ingest(
      db,
      uploadSource,
      body(
        event({
          request_id: 'shared-ray',
          timestamp: new Date(now.getTime() - 86400000).toISOString(),
        }),
      ),
      { uploadId: upload.id, seq: 1, key: upload.id + ':1' },
    );
    expect(replay).toMatchObject({ lines_matched: 0, lines_duplicate: 1, lines_overlapping: 0 });
    expect(
      await db
        .selectFrom('bot_requests')
        .select('id')
        .where('workspace_id', '=', tenant.workspaceId)
        .execute(),
    ).toHaveLength(1);
    expect(
      (await ingest(db, source, body(event({ path: '/after-rejected-overlap' })), {}))
        .lines_matched,
    ).toBe(1);
    await db
      .updateTable('crawl_log_uploads')
      .set({ updated_at: new Date(now.getTime() - 25 * 3600000) })
      .where('id', '=', upload.id)
      .execute();
    expect(await abandonUploads(db, tenant.workspaceId, now)).toBe(1);
    expect(
      (
        await db
          .selectFrom('crawl_log_uploads')
          .select('status')
          .where('id', '=', upload.id)
          .executeTakeFirstOrThrow()
      ).status,
    ).toBe('abandoned');
  });
  it('two concurrent refreshes converge, new receipts coalesce and Worker coverage stays partial', async () => {
    const { tenant, source } = await setup('cloudflare_worker');
    await ingest(db, source, body(event()), { key: 'first' });
    await ingest(db, source, body(event({ path: '/second' })), { key: 'second' });
    await Promise.all([refreshCrawlLogs(db, scope(tenant)), refreshCrawlLogs(db, scope(tenant))]);
    const total = await db
      .selectFrom('bot_activity_daily')
      .select(sql<number>`sum(requests)::integer`.as('requests'))
      .where('workspace_id', '=', tenant.workspaceId)
      .executeTakeFirstOrThrow();
    expect(total.requests).toBe(2);
    const day = await db
      .selectFrom('crawl_log_coverage_daily')
      .selectAll()
      .where('source_id', '=', source.id)
      .where('batch_count', '>', 0)
      .executeTakeFirstOrThrow();
    expect(day).toMatchObject({ coverage: 'partial', reason: 'best_effort_worker' });
    expect(
      await db
        .selectFrom('analytics_tasks')
        .select('id')
        .where('workspace_id', '=', tenant.workspaceId)
        .where('task_kind', '=', 'crawl_log_rollup_refresh')
        .execute(),
    ).toHaveLength(1);
  });
  it('freezes old rollups even after raw retention deletes their requests', async () => {
    const { tenant, source } = await setup();
    await ingest(db, source, body(event()), {});
    await refreshCrawlLogs(db, scope(tenant), now);
    const future = new Date(now.getTime() + 100 * 86400000);
    await db.deleteFrom('bot_requests').where('workspace_id', '=', tenant.workspaceId).execute();
    await refreshCrawlLogs(db, scope(tenant), future);
    const total = await db
      .selectFrom('bot_activity_daily')
      .select(sql<number>`sum(requests)::integer`.as('requests'))
      .where('workspace_id', '=', tenant.workspaceId)
      .executeTakeFirstOrThrow();
    expect(total.requests).toBe(1);
  });
});

describe('persisted analytics and coverage decisions', () => {
  it('requires a whole unsampled day with bounded receipt gaps before showing measured zero', async () => {
    const { tenant, source } = await setup();
    // Exercise the oldest unfrozen calendar day, including its early receipts.
    const day = new Date(
        now.getTime() - (crawlLogs.retention_days - crawlLogs.rollup_freeze_margin_days) * 86400000,
      )
        .toISOString()
        .slice(0, 10),
      start = new Date(day + 'T00:00:00Z');
    await db
      .updateTable('crawl_log_sources')
      .set({ created_at: start })
      .where('id', '=', source.id)
      .execute();
    const seed = await ingest(db, source, Buffer.alloc(0), { now: start, key: 'heartbeat-seed' });
    const receipts = Array.from({ length: 287 }, (_, i) => ({
      ...seed,
      id: randomUUID(),
      idempotency_key: 'heartbeat-' + i,
      received_at: new Date(start.getTime() + (i + 1) * 5 * 60000),
    }));
    await db.insertInto('crawl_log_batches').values(receipts).execute();
    await createSource(db, scope(tenant), tenant.userId, {
      setup: 'upload',
      origin: 'https://acme.example',
      format: 'ndjson',
    });
    await refreshCrawlLogs(db, scope(tenant));
    const options = { start_date: day, end_date: day };
    expect(await crawlSummary(db, scope(tenant), options)).toMatchObject({
      coverage: 'complete',
      requests: 0,
      pages: 0,
      active_bots: 0,
    });
    await db
      .deleteFrom('crawl_log_batches')
      .where('workspace_id', '=', tenant.workspaceId)
      .where('idempotency_key', '=', 'heartbeat-20')
      .execute();
    await refreshCrawlLogs(db, scope(tenant));
    expect(await crawlSummary(db, scope(tenant), options)).toMatchObject({
      coverage: 'partial',
      requests: null,
      pages: null,
      active_bots: null,
    });
  });
  it('dates preset windows in the reporting timezone and judges completeness over closed days', async () => {
    const { tenant, source } = await setup();
    const timeZone = 'Pacific/Kiritimati';
    await db
      .updateTable('crawl_log_states')
      .set({ reporting_timezone: timeZone })
      .where('workspace_id', '=', tenant.workspaceId)
      .where('project_id', '=', tenant.projectId)
      .execute();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
    const day = (offset: number) =>
      new Date(Date.parse(today) - offset * 86400000).toISOString().slice(0, 10);
    // Every closed day is complete; the day in progress can only be partial.
    await db
      .insertInto('crawl_log_coverage_daily')
      .values(
        Array.from({ length: 30 }, (_, offset) => ({
          id: randomUUID(),
          workspace_id: tenant.workspaceId,
          project_id: tenant.projectId,
          source_id: source.id,
          reporting_date: day(offset),
          reporting_timezone: timeZone,
          coverage: offset === 0 ? 'partial' : 'complete',
          reason: 'test',
          batch_count: 1,
          heartbeat_count: 1,
          max_gap_minutes: 5,
        })),
      )
      .execute();
    expect(await crawlSummary(db, scope(tenant), { range: '30d' })).toMatchObject({
      coverage: 'complete',
      requests: 0,
    });
    expect(await pagesRead(db, scope(tenant), { range: '30d' })).toMatchObject({
      window_start: day(29),
      window_end: today,
    });
    await db
      .deleteFrom('crawl_log_coverage_daily')
      .where('workspace_id', '=', tenant.workspaceId)
      .where('reporting_date', '=', sql<Date>`${day(1)}::date`)
      .execute();
    expect(await crawlSummary(db, scope(tenant), { range: '30d' })).toMatchObject({
      coverage: 'partial',
      requests: null,
    });
  });
  it('applies verification to all denominators and binds activity cursors to scope and filters', async () => {
    const { tenant, source } = await setup(),
      id = randomUUID();
    snapshotIds.push(id);
    await db
      .insertInto('bot_ip_range_snapshots')
      .values({
        id,
        bot_id: 'openai_gptbot',
        source_url: 'https://openai.com/gptbot.json',
        fetched_at: now,
        content_hash: 'test',
        cidrs: '["192.0.2.0/24"]',
        status: 'succeeded',
      })
      .execute();
    const failedId = randomUUID();
    snapshotIds.push(failedId);
    await db
      .insertInto('bot_ip_range_snapshots')
      .values({
        id: failedId,
        bot_id: 'openai_gptbot',
        source_url: 'https://openai.com/gptbot.json',
        fetched_at: new Date(now.getTime() + 60000),
        content_hash: 'failure',
        cidrs: '[]',
        status: 'failed',
      })
      .execute();
    await ingest(
      db,
      source,
      body(
        event({ path: '/verified', status: 200 }),
        event({ path: '/unverifiable', client_ip: null, status: 404 }),
        event({ path: '/spoofed', client_ip: '203.0.113.1', status: 403 }),
      ),
      {},
    );
    await refreshCrawlLogs(db, scope(tenant));
    expect(await crawlSummary(db, scope(tenant))).toMatchObject({
      requests: 2,
      pages: 2,
      active_bots: 1,
      error_share: 0.5,
      failed_verification_requests: 1,
    });
    expect(await crawlSummary(db, scope(tenant), { verification: 'verified' })).toMatchObject({
      requests: 1,
      pages: 1,
      active_bots: 1,
      error_share: null,
    });
    expect(
      (await crawlerPage(db, scope(tenant), { verification: 'failed_verification' })).items[0],
    ).toMatchObject({ requests: 1, pages: 1, status_codes: { '403': 1 } });
    const page = await activityPage(db, scope(tenant), { limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.next_cursor).not.toBeNull();
    const next = await activityPage(db, scope(tenant), { limit: 1, cursor: page.next_cursor });
    expect(next.items[0]!.id).not.toBe(page.items[0]!.id);
    // The Agent shrinks or widens a page; the cursor still resumes after the same row.
    const wider = await activityPage(db, scope(tenant), { limit: 5, cursor: page.next_cursor });
    expect(wider.items[0]!.id).toBe(next.items[0]!.id);
    await expect(
      activityPage(db, scope(tenant), { limit: 1, cursor: page.next_cursor, status: 403 }),
    ).rejects.toThrow(/filters/);
    const other = await fixtures.tenant();
    await expect(
      activityPage(db, scope(other), { limit: 1, cursor: page.next_cursor }),
    ).rejects.toThrow(/filters/);
    const principal = {
      kind: 'member' as const,
      userId: tenant.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
    };
    const mcp = await dispatchTool(
      db,
      principal,
      'read_crawl_logs',
      { project_id: tenant.projectId, view: 'summary', verification: 'verified', range: '30d' },
      'https://citeladder.test',
    );
    expect(mcp).toMatchObject({ requests: 1, pages: 1, unit: 'requests' });
    await expect(
      dispatchTool(
        db,
        principal,
        'read_crawl_logs',
        { project_id: other.projectId, view: 'requests' },
        'https://citeladder.test',
      ),
    ).rejects.toThrow();
    const cookie = TEST_SESSION_COOKIE + '=' + (await sessionToken({ sub: tenant.userId, ver: 0 }));
    const exported = await app.request(
      '/api/v1/projects/' + tenant.projectId + '/ai-traffic/activity/export?status=404',
      { headers: { cookie } },
    );
    expect(exported.status).toBe(200);
    const csv = await exported.text();
    expect(csv).toContain('/unverifiable');
    expect(csv).not.toContain('/verified');
    expect(csv).not.toContain('203.0.113.1');
  });
});

describe('bounded maintenance', () => {
  it('stalls a quiet live source after the window and clears it on an accepted receipt', async () => {
    const { tenant, source, token } = await setup();
    const later = new Date(Date.now() + (crawlLogs.stalled_after_hours + 1) * 3600000);
    await crawlLogTick(db, new Date());
    expect((await sourceList(db, scope(tenant))).items[0]).toMatchObject({
      state: 'active',
      stall_reason: null,
    });
    await crawlLogTick(db, later);
    expect((await sourceList(db, scope(tenant))).items[0]).toMatchObject({
      state: 'stalled',
      stall_reason: 'no_receipts',
      stalled_at: later.toISOString(),
    });
    expect((await send(source.id, token, body(event()))).status).toBe(202);
    expect((await sourceList(db, scope(tenant))).items[0]).toMatchObject({
      state: 'active',
      stall_reason: null,
      stalled_at: null,
    });
  });
  it('refuses a project over its daily received bytes until the next reporting day', async () => {
    const { tenant, source, token } = await setup();
    const old = crawlLogs.received_bytes_per_project_per_day;
    const payload = body(event());
    crawlLogs.received_bytes_per_project_per_day = payload.length;
    try {
      expect((await send(source.id, token, payload)).status).toBe(202);
      const refused = await send(source.id, token, payload);
      expect(refused.status).toBe(429);
      const midnight = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z') + 86400000;
      const retryAfter = Number(refused.headers.get('retry-after'));
      expect(Math.abs(retryAfter - (midnight - Date.now()) / 1000)).toBeLessThan(5);
      expect((await send(source.id, token, payload)).status).toBe(429);
      const receipts = await db
        .selectFrom('crawl_log_batches')
        .select(['status', 'bytes_received', 'lines_received'])
        .where('workspace_id', '=', tenant.workspaceId)
        .where('source_id', '=', source.id)
        .orderBy('received_at')
        .execute();
      expect(receipts).toEqual([
        { status: 'accepted', bytes_received: payload.length, lines_received: 1 },
        { status: 'bytes_ceiling', bytes_received: 0, lines_received: 0 },
      ]);
    } finally {
      crawlLogs.received_bytes_per_project_per_day = old;
    }
  });
  it('continues scheduling retention and upload cleanup with ingestion disabled', async () => {
    const { tenant } = await setup();
    crawlLogs.ingestion_enabled = false;
    try {
      await crawlLogTick(db, now);
      const tasks = await db
        .selectFrom('analytics_tasks')
        .select('task_kind')
        .where('workspace_id', '=', tenant.workspaceId)
        .execute();
      expect(tasks.map((task) => task.task_kind)).toEqual(
        expect.arrayContaining(['bot_request_retention_sweep', 'crawl_log_upload_abandon_sweep']),
      );
      expect(tasks.some((task) => task.task_kind === 'bot_ip_range_refresh')).toBe(false);
    } finally {
      crawlLogs.ingestion_enabled = true;
    }
  });
  it('deletes expired raw requests while retaining receipts and projections', async () => {
    const { tenant, source } = await setup();
    await ingest(db, source, body(event()), {});
    await refreshCrawlLogs(db, scope(tenant));
    const originalReasons = (await crawlerPage(db, scope(tenant))).items[0]!.verification_reasons;
    await db
      .updateTable('bot_requests')
      .set({ occurred_at: new Date(Date.now() - 91 * 86400000) })
      .where('workspace_id', '=', tenant.workspaceId)
      .execute();
    const task = await db
      .selectFrom('analytics_tasks')
      .selectAll()
      .where('workspace_id', '=', tenant.workspaceId)
      .executeTakeFirstOrThrow();
    await botRequestRetentionSweep(task, { db, maxAttempts: 3, checkCancelled: async () => {} });
    expect(
      await db
        .selectFrom('bot_requests')
        .select('id')
        .where('workspace_id', '=', tenant.workspaceId)
        .execute(),
    ).toHaveLength(0);
    expect(
      await db
        .selectFrom('crawl_log_batches')
        .select('id')
        .where('workspace_id', '=', tenant.workspaceId)
        .execute(),
    ).toHaveLength(1);
    expect(
      await db
        .selectFrom('bot_activity_daily')
        .select('requests')
        .where('workspace_id', '=', tenant.workspaceId)
        .execute(),
    ).toMatchObject([{ requests: 1 }]);
    expect((await crawlerPage(db, scope(tenant))).items[0]?.verification_reasons).toEqual(
      originalReasons,
    );
  });
  it('appends successful and failed IP snapshots through fenced settlement without live I/O', async () => {
    const { tenant, source } = await setup();
    await ingest(db, source, Buffer.alloc(0), { key: 'snapshot-dispatch-heartbeat' });
    const row = await db
      .selectFrom('analytics_tasks')
      .selectAll()
      .where('workspace_id', '=', tenant.workspaceId)
      .executeTakeFirstOrThrow();
    const task = { ...row, payload: { bot_id: 'openai_gptbot' } };
    for (const success of [true, false]) {
      const execute = botIpRangeRefresh(async () => ({
        url: 'https://openai.com/gptbot.json',
        status: success ? 200 : 503,
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] })),
      }));
      const result = await execute(task, { db, maxAttempts: 3, checkCancelled: async () => {} });
      if (!result) throw new Error('Snapshot settlement absent');
      await db.transaction().execute(result.persist);
    }
    const snapshots = await db
      .selectFrom('bot_ip_range_snapshots')
      .selectAll()
      .where('bot_id', '=', 'openai_gptbot')
      .execute();
    snapshotIds.push(...snapshots.filter((s) => !snapshotIds.includes(s.id)).map((s) => s.id));
    expect(
      snapshots.some(
        (s) =>
          s.status === 'succeeded' && Array.isArray(s.cidrs) && s.cidrs.includes('192.0.2.0/24'),
      ),
    ).toBe(true);
    expect(
      snapshots.some(
        (s) => s.status === 'failed' && Array.isArray(s.cidrs) && s.cidrs.length === 0,
      ),
    ).toBe(true);
  });
});
