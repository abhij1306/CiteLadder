import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { sql } from 'kysely';
import { createApp } from '../src/app.ts';
import { TEST_SESSION_COOKIE, testConfig, testDatabase, sessionToken } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';
import { crawlLogs } from '../src/config/crawl-logs.ts';
import { createSource } from '../src/crawl-logs/sources.ts';
import { ingest } from '../src/crawl-logs/ingest.ts';

// Forced collection makes the sampled heap the retained heap, not garbage awaiting a GC.
setFlagsFromString('--expose-gc');
const collect = runInNewContext('gc') as () => void;

const config = testConfig(),
  db = testDatabase(config),
  fixtures = new VisibilityFixtures(db),
  app = createApp(config, db);
const original = { ...crawlLogs };
const ROWS = 100_000;
/** Below the export's own CSV text, which a buffered export would retain whole. */
const HEAP_BOUND = 8 * 1024 * 1024;
let tenant: Tenant;

beforeAll(async () => {
  crawlLogs.ingestion_enabled = true;
  tenant = await fixtures.tenant();
  const scope = { workspaceId: tenant.workspaceId, projectId: tenant.projectId };
  const { id } = await createSource(db, scope, tenant.userId, {
    setup: 'custom',
    origin: 'https://acme.example',
    format: 'ndjson',
  });
  const source = await db
    .selectFrom('crawl_log_sources')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  const line = {
    timestamp: new Date().toISOString(),
    host: 'acme.example',
    path: '/guide',
    method: 'GET',
    status: 200,
    user_agent: 'GPTBot/1.0',
    client_ip: '192.0.2.2',
  };
  await ingest(db, source, Buffer.from(JSON.stringify(line)), { key: 'memory-seed' });
  // One statement copies the ingested request into the 100k verified rows the export reads.
  await sql`insert into bot_requests (id,workspace_id,project_id,source_id,batch_id,occurred_at,host,display_path,
      canonical_url,identity,identity_reason,url_hash,folder,resource_class,method,status_code,bot_id,catalog_version,
      verification,verification_reason,verification_basis,ip_range_snapshot_id,provider_request_id,line_hash)
    select gen_random_uuid(),workspace_id,project_id,source_id,batch_id,occurred_at-make_interval(secs=>n),host,
      display_path||'/'||n,canonical_url,identity,identity_reason,url_hash,folder,resource_class,method,status_code,
      bot_id,catalog_version,'verified',verification_reason,verification_basis,ip_range_snapshot_id,null,md5(n::text)||md5(id::text)
    from bot_requests,generate_series(1,${ROWS}) n
    where workspace_id=${tenant.workspaceId}::uuid and project_id=${tenant.projectId}::uuid`.execute(
    db,
  );
}, 120_000);
afterAll(async () => {
  Object.assign(crawlLogs, original);
  await fixtures.cleanup();
  await db.destroy();
});

describe('AI Traffic exports', () => {
  it('streams a 100k-row activity export while the retained heap stays bounded', async () => {
    const cookie = TEST_SESSION_COOKIE + '=' + (await sessionToken({ sub: tenant.userId, ver: 0 }));
    collect();
    const baseline = process.memoryUsage().heapUsed;
    const response = await app.request(
      '/api/v1/projects/' + tenant.projectId + '/ai-traffic/activity/export?verification=verified',
      { headers: { cookie } },
    );
    expect(response.status).toBe(200);
    const reader = response.body!.getReader(),
      decoder = new TextDecoder();
    let peak = 0,
      bytes = 0,
      lines = 0,
      chunks = 0,
      first = '',
      last = '',
      tail = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      const text = tail + decoder.decode(value, { stream: true });
      const parts = text.split('\r\n');
      tail = parts.pop() ?? '';
      if (lines <= 1) first = parts[1 - lines] ?? first;
      lines += parts.length;
      last = parts.at(-1) ?? last;
      if (++chunks % 5 === 0) {
        collect();
        peak = Math.max(peak, process.memoryUsage().heapUsed - baseline);
      }
    }
    // The header plus every row, newest first: one second before the seed down to the oldest.
    expect(lines).toBe(ROWS + 1);
    expect(first).toMatch(/,openai_gptbot,acme\.example,\/guide\/1,/u);
    expect(last).toMatch(/,openai_gptbot,acme\.example,\/guide\/100000,/u);
    expect(tail).toBe('');
    expect(bytes).toBeGreaterThan(HEAP_BOUND);
    expect(peak).toBeLessThan(HEAP_BOUND);
  }, 120_000);

  it('refuses an export past the cap before streaming any row', async () => {
    const cookie = TEST_SESSION_COOKIE + '=' + (await sessionToken({ sub: tenant.userId, ver: 0 }));
    crawlLogs.max_export_rows = ROWS - 1;
    try {
      const refused = await app.request(
        '/api/v1/projects/' +
          tenant.projectId +
          '/ai-traffic/activity/export?verification=verified',
        { headers: { cookie } },
      );
      expect(refused.status).toBe(422);
      expect(await refused.json()).toMatchObject({
        error: { message: 'Export exceeds configured bound; narrow the filters' },
      });
    } finally {
      crawlLogs.max_export_rows = original.max_export_rows;
    }
  });
});
