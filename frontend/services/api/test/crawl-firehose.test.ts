import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createApp } from '../src/app.ts';
import { testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';
import { crawlLogs } from '../src/config/crawl-logs.ts';
import { createSource, createSourceSchema, mutateSource } from '../src/crawl-logs/sources.ts';
import { ingest } from '../src/crawl-logs/ingest.ts';
import { refreshCrawlLogs } from '../src/crawl-logs/rollup.ts';
import { sourceList } from '../src/crawl-logs/source-reads.ts';

const config = testConfig(),
  db = testDatabase(config),
  fixtures = new VisibilityFixtures(db),
  app = createApp(config, db);
const original = { ...crawlLogs };
const now = new Date();
const scope = (t: Tenant) => ({ workspaceId: t.workspaceId, projectId: t.projectId });

/** One CloudFront standard logging (v2) JSON record. */
const log = (changes: Record<string, unknown> = {}) =>
  JSON.stringify({
    'timestamp(ms)': String(now.getTime()),
    'c-ip': '192.0.2.2',
    'sc-status': '200',
    'cs-method': 'GET',
    'cs-uri-stem': '/products/guide',
    'x-edge-request-id': randomUUID(),
    'x-host-header': 'acme.example',
    'cs(Host)': 'd111111abcdef8.cloudfront.net',
    'cs(User-Agent)': 'Mozilla/5.0%20(compatible;%20GPTBot/1.2;%20+https://openai.com/gptbot)',
    ...changes,
  });
const record = (...lines: string[]) => ({
  data: Buffer.from(lines.join('\n') + '\n').toString('base64'),
});
const envelope = (requestId: string, records: { data: string }[]) =>
  JSON.stringify({ requestId, timestamp: now.getTime(), records });

async function firehoseSource(options: { declared_filtered?: boolean } = {}) {
  const tenant = await fixtures.tenant();
  const created = await createSource(db, scope(tenant), tenant.userId, {
    setup: 'aws_firehose',
    origin: 'https://acme.example',
    format: 'ndjson',
    buffer_interval_seconds: 300,
    ...options,
  });
  return { tenant, id: created.id, token: created.token! };
}
function deliver(
  id: string,
  token: string,
  body: string | Uint8Array,
  options: { requestId?: string; gzip?: boolean; headers?: Record<string, string> } = {},
) {
  const requestId = options.requestId ?? randomUUID();
  const bytes = typeof body === 'string' ? Buffer.from(body) : Buffer.from(body);
  return app.request('/v1/crawl-logs/firehose/' + id, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-amz-firehose-request-id': requestId,
      'x-amz-firehose-access-key': token,
      ...(options.gzip ? { 'content-encoding': 'gzip' } : {}),
      ...options.headers,
    },
    body: new Uint8Array(options.gzip ? gzipSync(bytes) : bytes),
  });
}
const receipts = (sourceId: string) =>
  db
    .selectFrom('crawl_log_batches')
    .select(['status', 'idempotency_key', 'lines_received', 'lines_matched', 'lines_rejected'])
    .where('source_id', '=', sourceId)
    .orderBy('received_at')
    .orderBy('idempotency_key')
    .execute();

beforeAll(() => {
  crawlLogs.ingestion_enabled = true;
});
afterAll(async () => {
  Object.assign(crawlLogs, original);
  await fixtures.cleanup();
  await db.destroy();
});

describe('Firehose delivery', () => {
  it('admits a gzipped request of multi-line records and answers in the Firehose contract', async () => {
    const { id, token } = await firehoseSource();
    const requestId = randomUUID();
    const response = await deliver(
      id,
      token,
      envelope(requestId, [
        record(log(), log({ 'cs-uri-stem': '/second' })),
        record(log({ 'cs-uri-stem': '/third' })),
      ]),
      { requestId, gzip: true },
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(text)));
    expect(response.headers.get('content-encoding')).toBeNull();
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['requestId', 'timestamp']);
    expect(body.requestId).toBe(requestId);
    expect(Math.abs(Number(body.timestamp) - Date.now())).toBeLessThan(60_000);
    expect(await receipts(id)).toEqual([
      {
        status: 'accepted',
        idempotency_key: `firehose:${requestId}:0`,
        lines_received: 3,
        lines_matched: 3,
        lines_rejected: 0,
      },
    ]);
  });
  it('isolates an undecodable record and scopes by the viewer host, not the distribution', async () => {
    const { id, token } = await firehoseSource();
    const body = envelope('req-isolated', [
      { data: '%%%not-base64%%%' },
      record(log(), log({ 'x-host-header': 'elsewhere.example' })),
    ]);
    const response = await deliver(id, token, body, { requestId: 'req-isolated' });
    expect(response.status).toBe(200);
    const [receipt] = await db
      .selectFrom('crawl_log_batches')
      .select([
        'lines_received',
        'lines_matched',
        'lines_rejected',
        'lines_out_of_scope',
        'bytes_received',
      ])
      .where('source_id', '=', id)
      .execute();
    // The whole decompressed request counts toward the daily volume, bad records included.
    expect(receipt).toEqual({
      lines_received: 3,
      lines_matched: 1,
      lines_rejected: 1,
      lines_out_of_scope: 1,
      bytes_received: Buffer.byteLength(body),
    });
  });
  it('replays a retried request ID with its original receipt and no quota spend', async () => {
    const { id, token } = await firehoseSource();
    crawlLogs.batches_per_source_per_hour = 1;
    try {
      const body = envelope('req-retry', [record(log())]);
      for (let attempt = 0; attempt < 3; attempt++)
        expect((await deliver(id, token, body, { requestId: 'req-retry' })).status).toBe(200);
      expect(await receipts(id)).toHaveLength(1);
      // A delivered request ID is answered before its body is read or decoded.
      const garbled = await deliver(id, token, 'not a Firehose request', {
        requestId: 'req-retry',
      });
      expect(garbled.status).toBe(200);
      const other = await deliver(id, token, envelope('req-next', [record(log())]), {
        requestId: 'req-next',
      });
      expect(other.status).toBe(429);
      expect(await other.json()).toMatchObject({ requestId: 'req-next' });
    } finally {
      crawlLogs.batches_per_source_per_hour = original.batches_per_source_per_hour;
    }
  });
  it('splits a request above the per-batch line bound into idempotent chunks', async () => {
    const { id, token } = await firehoseSource();
    crawlLogs.max_lines_per_batch = 2;
    try {
      const lines = ['/a', '/b', '/c'].map((path) => log({ 'cs-uri-stem': path }));
      const response = await deliver(id, token, envelope('req-chunks', [record(...lines)]), {
        requestId: 'req-chunks',
      });
      expect(response.status).toBe(200);
    } finally {
      crawlLogs.max_lines_per_batch = original.max_lines_per_batch;
    }
    expect((await receipts(id)).map((r) => [r.idempotency_key, r.lines_matched])).toEqual([
      ['firehose:req-chunks:0', 2],
      ['firehose:req-chunks:1', 1],
    ]);
  });
  it.each([
    ['a request-ID mismatch', 'header-id', envelope('body-id', [record(log())]), 400],
    ['a body that is not a Firehose request', 'req-shape', '{"records":[]}', 400],
    [
      'console demo data without CloudFront fields',
      'req-demo',
      envelope('req-demo', [record('{"ticker_symbol":"QXZ","sector":"HEALTHCARE","price":84.5}')]),
      400,
    ],
  ])('answers %s with 400 and an error message', async (_, requestId, body, status) => {
    const { id, token } = await firehoseSource();
    const response = await deliver(id, token, body, { requestId });
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({
      requestId,
      errorMessage: expect.any(String),
    });
  });
  it('takes the token from the access-key header only', async () => {
    const { id, token } = await firehoseSource();
    const body = envelope('req-auth', [record(log())]);
    const wrong = await deliver(id, 'clw_wrong', body, { requestId: 'req-auth' });
    expect(wrong.status).toBe(401);
    const bearer = await deliver(id, '', body, {
      requestId: 'req-auth',
      headers: { authorization: 'Bearer ' + token },
    });
    expect(bearer.status).toBe(401);
  });
  it('answers 409 for a revoked source and paused collection', async () => {
    const revoked = await firehoseSource();
    await mutateSource(db, scope(revoked.tenant), revoked.tenant.userId, revoked.id, 'revoke');
    const body = envelope('req-409', [record(log())]);
    const options = { requestId: 'req-409' };
    expect((await deliver(revoked.id, revoked.token, body, options)).status).toBe(409);
    const paused = await firehoseSource();
    crawlLogs.ingestion_enabled = false;
    try {
      expect((await deliver(paused.id, paused.token, body, options)).status).toBe(409);
    } finally {
      crawlLogs.ingestion_enabled = true;
    }
  });
  it('records an oversize request, which Firehose drops, on a receipt and the source row', async () => {
    const { tenant, id, token } = await firehoseSource();
    const body = envelope('req-big', [record(log(), log(), log())]);
    crawlLogs.max_batch_bytes = body.length - 1;
    try {
      const response = await deliver(id, token, body, { requestId: 'req-big' });
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ requestId: 'req-big' });
    } finally {
      crawlLogs.max_batch_bytes = original.max_batch_bytes;
    }
    expect((await receipts(id)).map((r) => r.status)).toEqual(['oversize']);
    expect((await sourceList(db, scope(tenant))).items[0]).toMatchObject({
      state: 'stalled',
      stall_reason: 'oversize',
    });
  });
  it('refuses a source of another setup on the Firehose endpoint', async () => {
    const tenant = await fixtures.tenant();
    const custom = await createSource(db, scope(tenant), tenant.userId, {
      setup: 'custom',
      origin: 'https://acme.example',
      format: 'ndjson',
    });
    const response = await deliver(custom.id, custom.token!, envelope('req-x', [record(log())]), {
      requestId: 'req-x',
    });
    expect(response.status).toBe(409);
  });
});

describe('Firehose source setup and coverage', () => {
  it('stores the declared interval and keeps the Firehose fields to that setup', async () => {
    const { tenant, id } = await firehoseSource();
    const other = await fixtures.tenant();
    expect((await sourceList(db, scope(tenant))).items[0]).toMatchObject({
      id,
      setup: 'aws_firehose',
      kind: 'webhook',
      preset: 'cloudfront_v2_json',
      collection_point: 'cdn_edge',
      sampling: { kind: 'none' },
      buffer_interval_seconds: 300,
    });
    expect((await sourceList(db, scope(other))).items).toEqual([]);
    const parse = (input: Record<string, unknown>) =>
      createSourceSchema.safeParse({ origin: 'https://acme.example', ...input }).success;
    expect(parse({ setup: 'aws_firehose', buffer_interval_seconds: 60 })).toBe(true);
    expect(parse({ setup: 'aws_firehose' })).toBe(false);
    expect(parse({ setup: 'aws_firehose', buffer_interval_seconds: 30 })).toBe(false);
    expect(
      parse({ setup: 'aws_firehose', buffer_interval_seconds: 60, sampling: { kind: 'none' } }),
    ).toBe(false);
    expect(parse({ setup: 'custom', buffer_interval_seconds: 60 })).toBe(false);
    expect(parse({ setup: 'custom', declared_filtered: true })).toBe(false);
  });
  it.each([
    [{}, 9, 'complete'],
    [{}, 11, 'partial'],
    [{ declared_filtered: true }, 9, 'partial'],
  ])(
    'judges a day with %j and %i-minute receipt gaps as %s',
    async (options, gapMinutes, coverage) => {
      const { tenant, id } = await firehoseSource(options);
      const day = new Date(now.getTime() - 3 * 86400000).toISOString().slice(0, 10),
        start = new Date(day + 'T00:00:00Z');
      await db
        .updateTable('crawl_log_sources')
        .set({ created_at: start })
        .where('id', '=', id)
        .execute();
      const source = await db
        .selectFrom('crawl_log_sources')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      const seed = await ingest(db, source, Buffer.alloc(0), { now: start, key: 'seed' });
      const count = Math.floor((24 * 60) / gapMinutes);
      await db
        .insertInto('crawl_log_batches')
        .values(
          Array.from({ length: count }, (_, i) => ({
            ...seed,
            id: randomUUID(),
            idempotency_key: 'heartbeat-' + i,
            received_at: new Date(start.getTime() + (i + 1) * gapMinutes * 60000),
          })),
        )
        .execute();
      await refreshCrawlLogs(db, scope(tenant), now, [day]);
      const row = await db
        .selectFrom('crawl_log_coverage_daily')
        .select('coverage')
        .where('source_id', '=', id)
        .where('reporting_date', '=', new Date(day + 'T00:00:00Z'))
        .executeTakeFirstOrThrow();
      expect(row.coverage).toBe(coverage);
    },
  );
});
