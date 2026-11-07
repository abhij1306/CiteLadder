import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';
import { TEST_SESSION_COOKIE, testConfig, testDatabase, sessionToken } from './support.ts';
import { createApp } from '../src/app.ts';
import { policy } from '../src/config.ts';
import { seedClassifiedPairs, seedImport } from './referral-fixtures.ts';
import { task, requests } from './traffic-fixtures.ts';
import { createSource } from '../src/crawl-logs/sources.ts';
import { crawlLogs } from '../src/config/crawl-logs.ts';
import { aiTraffic, insightsRefresh } from '../src/config/ai-traffic.ts';
import { ingest } from '../src/crawl-logs/ingest.ts';
import { refreshCrawlLogs } from '../src/crawl-logs/rollup.ts';
import { refreshAiReferralsSnapshot } from '../src/referrals/snapshot.ts';
import { pagesRead, urlRead, pageContext } from '../src/ai-traffic/pages.ts';
import { pageDataset, type JoinedPage } from '../src/ai-traffic/pages-data.ts';
import {
  insightPatterns,
  refreshTrafficInsights,
  refreshInsightWindow,
  insightsRead,
} from '../src/ai-traffic/insights.ts';
import { enqueueCoalesced } from '../src/queue/enqueue.ts';
import { hash } from '../src/crypto-text.ts';
import { canonicalPage } from '../src/page-identity.ts';
import { canonicalIdentity } from '../src/site-health/url-identity.ts';
import { dispatchTool } from '../src/mcp/tools.ts';

const db = testDatabase(),
  fixtures = new SiteFixtures(db),
  original = crawlLogs.ingestion_enabled;
const day = new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10),
  now = new Date();
const filters = { start_date: day, end_date: day },
  context = { db, maxAttempts: 3, checkCancelled: async () => {} };
let seed: SiteSeed, sourceId: string, artifactId: string;
const scope = () => ({ workspaceId: seed.workspaceId, projectId: seed.projectId });
const guide = hash('https://example.test/guide');
beforeAll(async () => {
  crawlLogs.ingestion_enabled = true;
  seed = await fixtures.crawl();
  await fixtures.page(seed, '/guide', {}, { observed: true });
  await fixtures.page(seed, '/quiet', {}, { observed: true });
  const source = await createSource(db, scope(), seed.userId, {
    setup: 'custom',
    origin: 'https://example.test',
    format: 'ndjson',
    sampling: { kind: 'none' },
  });
  sourceId = source.id;
  const stored = await db
    .selectFrom('crawl_log_sources')
    .selectAll()
    .where('id', '=', sourceId)
    .executeTakeFirstOrThrow();
  const lines = ['OAI-SearchBot/1.0', 'PerplexityBot/1.0'].flatMap((ua, b) =>
    Array.from({ length: 3 }, (_, i) =>
      JSON.stringify({
        timestamp: day + `T12:00:0${i}Z`,
        host: 'example.test',
        path: '/guide?secret=redacted',
        method: 'GET',
        status: b === 1 && i < 2 ? 403 : 200,
        user_agent: ua,
        request_id: 'request-' + b + '-' + i,
      }),
    ),
  );
  lines.push(
    JSON.stringify({
      timestamp: day + 'T12:01:00Z',
      host: 'example.test',
      path: '/reset/secret-value',
      method: 'GET',
      status: 200,
      user_agent: 'GPTBot/1.0',
    }),
  );
  await ingest(db, stored, Buffer.from(lines.join('\n')), {});
  await refreshCrawlLogs(db, scope(), now, [day]);
  // This fixture records the complete collection claim; the separate Crawl Logs suite validates gap detection.
  await db
    .insertInto('crawl_log_coverage_daily')
    .values({
      id: randomUUID(),
      workspace_id: seed.workspaceId,
      project_id: seed.projectId,
      source_id: sourceId,
      reporting_date: day,
      reporting_timezone: 'UTC',
      coverage: 'complete',
      reason: 'fixture',
      batch_count: 1,
      heartbeat_count: 0,
      max_gap_minutes: 0,
    })
    .onConflict((c) =>
      c.constraint('uq_crawl_log_coverage_day').doUpdateSet({ coverage: 'complete' }),
    )
    .execute();
  const imported = await seedImport(db, {
    ...scope(),
    dataset: 'ga4_landing_daily',
    window: [day, day],
  });
  artifactId = imported.artifactId;
  await db
    .updateTable('integration_import_artifacts')
    .set({
      extract_metadata: JSON.stringify({
        timeZone: 'UTC',
        currencyCode: 'USD',
        analytics_quality: [],
        truncated: false,
      }),
    })
    .where('id', '=', artifactId)
    .execute();
  for (const [i, source] of ['chatgpt.com', 'claude.ai'].entries())
    await db
      .insertInto('integration_metric_rows')
      .values({
        id: randomUUID(),
        workspace_id: seed.workspaceId,
        project_id: seed.projectId,
        property_ref: 'properties/123456789',
        provider: 'ga4',
        dataset: 'ga4_landing_daily',
        date: day,
        dimension_key: ['/guide', source, 'referral', 'example.test', day].join(' | '),
        metrics: JSON.stringify({ sessions: i ? 5 : 3, engagedSessions: 2, keyEvents: i ? 2 : 1 }),
        source_artifact_id: artifactId,
        resync_seq: 0,
        importer_version: '1',
        created_at: now,
      })
      .execute();
  // Landing rows take their AI source from the persisted source/medium classifications.
  await seedClassifiedPairs(db, imported, {
    date: day,
    pairs: [
      ['chatgpt.com', 'referral'],
      ['claude.ai', 'referral'],
    ],
  });
  await refreshAiReferralsSnapshot(
    await task(db, seed, 'ai_referrals_snapshot_refresh', [day, day]),
    context,
  );
  const auditId = await fixtures.audit(seed);
  await db
    .updateTable('audits')
    .set({ created_at: new Date(day + 'T13:00:00Z') })
    .where('id', '=', auditId)
    .execute();
  await fixtures.execution(seed, {
    auditId,
    analysis: {
      citations: Array.from({ length: 3 }, () => ({
        url: 'https://example.test/guide',
        isOwned: true,
        urlHash: guide,
      })),
    },
  });
});
afterAll(async () => {
  crawlLogs.ingestion_enabled = original;
  await fixtures.cleanup();
  await db.destroy();
});

describe('A3 persisted Pages join', () => {
  it('distinguishes pending insight filters from a persisted empty pattern', async () => {
    const options = { ...filters, pattern: 'crawled_without_referrals' };
    await expect(pagesRead(db, scope(), options)).rejects.toMatchObject({
      status: 409,
      retryable: true,
    });
    await refreshInsightWindow(db, scope(), filters);
    expect((await pagesRead(db, scope(), options)).items).toEqual([]);
  });
  it('never counts citation rows on Overview when the run has no persisted citation fact', async () => {
    // The fixture run is completed with three owned citations but was never
    // finalized, so it has no fact: Overview says not computed, not 3 or 0.
    const config = testConfig(),
      app = createApp(config, db);
    const cookie = TEST_SESSION_COOKIE + '=' + (await sessionToken({ sub: seed.userId, ver: 0 }));
    const response = await app.request(
      `/api/v1/projects/${seed.projectId}/ai-traffic/overview?range=30d`,
      { headers: { cookie } },
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { citations: unknown }).citations).toEqual({
      unit: 'tracked_citations',
      state: 'not_available',
      reason: 'not_computed',
      count: null,
      label: "Observed in CiteLadder's tracked answers",
    });
  });
  it('reads every Overview section over the explicit dates when a preset is also sent', async () => {
    const id = randomUUID();
    await db
      .insertInto('ai_referrals_snapshots')
      .values({
        id,
        workspace_id: seed.workspaceId,
        project_id: seed.projectId,
        window_start: new Date('2026-01-01T00:00:00Z'),
        window_end: new Date('2026-01-07T00:00:00Z'),
        granularity: 'day',
        preset_window_days: null,
        analyzer_version: policy.analytics.ai_referral_analyzer_version,
        formula_version: policy.analytics.ai_referral_formula_version,
        metrics: JSON.stringify({ referral_volume: [], referral_share: [], sources: [] }),
        source_classification_ids: JSON.stringify([]),
        created_at: new Date(),
      })
      .execute();
    try {
      const config = testConfig(),
        app = createApp(config, db);
      const cookie = TEST_SESSION_COOKIE + '=' + (await sessionToken({ sub: seed.userId, ver: 0 }));
      const response = await app.request(
        `/api/v1/projects/${seed.projectId}/ai-traffic/overview?range=30d&start_date=2026-01-01&end_date=2026-01-07`,
        { headers: { cookie } },
      );
      expect(response.status).toBe(200);
      const { referrals } = (await response.json()) as {
        referrals: { window_start: string; window_end: string };
      };
      expect([referrals.window_start, referrals.window_end]).toEqual(['2026-01-01', '2026-01-07']);
    } finally {
      await db.deleteFrom('ai_referrals_snapshots').where('id', '=', id).execute();
    }
  });
  it('selects the highest detail aggregates deterministically when capped, including ties', async () => {
    const originalCap = aiTraffic.max_timeline_items;
    aiTraffic.max_timeline_items = 1;
    try {
      const detail = await urlRead(db, scope(), guide, filters);
      expect(detail.crawls.map((r) => r.bot_id)).toEqual(['openai_oai_searchbot']);
      expect(detail.referrals.map((r) => [r.ai_source, r.sessions])).toEqual([['claude', 5]]);
      expect(detail.provenance.bounded).toBe(true);
      await db
        .updateTable('ai_referral_landing_daily')
        .set({ sessions: 5 })
        .where('project_id', '=', seed.projectId)
        .where('ai_source', '=', 'chatgpt')
        .execute();
      expect((await urlRead(db, scope(), guide, filters)).referrals[0]?.ai_source).toBe('chatgpt');
    } finally {
      aiTraffic.max_timeline_items = originalCap;
      await db
        .updateTable('ai_referral_landing_daily')
        .set({ sessions: 3 })
        .where('project_id', '=', seed.projectId)
        .where('ai_source', '=', 'chatgpt')
        .execute();
    }
  });
  it('narrows a path detail to one crawler when the drawer names it', async () => {
    const detail = await urlRead(db, scope(), guide, {
      ...filters,
      bot_id: 'openai_oai_searchbot',
    });
    expect(detail.crawls.map((r) => [r.bot_id, r.requests])).toEqual([['openai_oai_searchbot', 3]]);
    expect(detail.page?.crawl).toMatchObject({ state: 'value', value: 3 });
  });
  it('aggregates bots and sources independently, gates inventory coverage and preserves detail totals', async () => {
    const result = await pagesRead(db, scope(), filters),
      row = result.items.find((r) => r.url_hash === guide)!;
    expect(row).toMatchObject({
      crawl: { state: 'value', value: 6 },
      referrals: { state: 'value', value: 8 },
      key_events: 3,
      // The fixture run was never finalized: three owned citation rows, no fact.
      citations: { state: 'unavailable', value: null, reason: 'not_computed' },
      findings: { state: 'zero', value: 0 },
      errors_4xx: 2,
      errors_5xx: 0,
    });
    expect(result.items).toHaveLength(2);
    expect(result.observed_crawl_coverage.share).toBe(0.5);
    const detail = await urlRead(db, scope(), guide, filters);
    expect(detail.crawls.reduce((sum, r) => sum + r.requests, 0)).toBe(6);
    expect(detail.referrals.reduce((sum, r) => sum + r.sessions, 0)).toBe(8);
    expect(detail.page?.crawl).toMatchObject({ state: 'value', value: 6 });
    expect(detail.citations).toEqual([]);
    expect(result.items.some((r) => r.display_path.includes('secret-value'))).toBe(false);
    await db
      .updateTable('crawl_log_coverage_daily')
      .set({ coverage: 'partial' })
      .where('source_id', '=', sourceId)
      .where('reporting_date', '=', new Date(day))
      .execute();
    const partial = await pagesRead(db, scope(), filters);
    expect(partial.observed_crawl_coverage.share).toBeNull();
    expect(partial.items.find((r) => r.display_path === '/quiet')?.crawl.state).toBe('unavailable');
    await db
      .updateTable('crawl_log_coverage_daily')
      .set({ coverage: 'complete' })
      .where('source_id', '=', sourceId)
      .where('reporting_date', '=', new Date(day))
      .execute();
  });
  it('binds keyset cursors to window, folder, verification and sort, and exports the same saved measures', async () => {
    const first = await pagesRead(db, scope(), { ...filters, limit: 1 });
    expect(first.next_cursor).toBeTruthy();
    const second = await pagesRead(db, scope(), {
      ...filters,
      limit: 1,
      cursor: first.next_cursor,
    });
    expect(second.items[0]?.display_path).toBe('/quiet');
    for (const change of [
      { folder: '/guide' },
      { sort: 'sessions_desc' },
      { verification: 'verified' },
      { end_date: now.toISOString().slice(0, 10) },
    ])
      await expect(
        pagesRead(db, scope(), { ...filters, limit: 1, cursor: first.next_cursor, ...change }),
      ).rejects.toThrow(/cursor/);
    expect((await pagesRead(db, scope(), { ...filters, folder: '/guide' })).items).toHaveLength(1);
    const appRequest = await requests(
      db,
      seed,
    )(`ai-traffic/pages?start_date=${day}&end_date=${day}`);
    expect(appRequest.response.status).toBe(200);
    const { createApp } = await import('../src/app.ts');
    const { testConfig, sessionToken } = await import('./support.ts');
    const config = testConfig();
    const response = await createApp(config, db).request(
      `/api/v1/projects/${seed.projectId}/ai-traffic/pages/export?start_date=${day}&end_date=${day}&folder=/guide`,
      {
        headers: {
          'x-workspace-id': seed.workspaceId,
          cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: seed.userId, ver: 0 })}`,
        },
      },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('https://example.test/guide');
  });
  it('keeps a preset’s pages on the first page’s window when the reporting day rolls over', async () => {
    const next = (date: string) => new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10);
    const evening = next(day),
      morning = next(evening);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(`${evening}T23:59:59.000Z`));
      const first = await pagesRead(db, scope(), { range: '30d', limit: 1 });
      expect([first.window_end, first.items[0]?.display_path]).toEqual([evening, '/guide']);
      vi.setSystemTime(new Date(`${morning}T00:00:01.000Z`));
      const second = await pagesRead(db, scope(), {
        range: '30d',
        limit: 1,
        cursor: first.next_cursor,
      });
      expect([second.window_start, second.window_end, second.items[0]?.display_path]).toEqual([
        first.window_start,
        evening,
        '/quiet',
      ]);
      // A new first page reads the new reporting day.
      expect((await pagesRead(db, scope(), { range: '30d', limit: 1 })).window_end).toBe(morning);
      // The cursor's window must span the preset it continues.
      await expect(
        pagesRead(db, scope(), { range: '90d', limit: 1, cursor: first.next_cursor }),
      ).rejects.toThrow(/cursor/);
    } finally {
      vi.useRealTimers();
    }
  });
  it('exports in one bounded read exactly the CSV that walking every page cursor yields', async () => {
    const paged: Awaited<ReturnType<typeof pagesRead>>['items'] = [];
    let cursor: string | null = null,
      pages = 0;
    do {
      const page = await pagesRead(db, scope(), { ...filters, limit: 1, cursor });
      paged.push(...page.items);
      cursor = page.next_cursor;
      pages++;
    } while (cursor);
    expect(pages).toBeGreaterThan(1);
    const header =
      'canonical_url,url_hash,folder,resource_class,crawl_state,requests,last_crawl,errors_4xx,errors_5xx,referral_state,sessions,key_events,citation_state,tracked_citations,findings_state,open_findings';
    const expected = [
      header,
      ...paged.map((r) =>
        [
          r.canonical_url,
          r.url_hash,
          r.folder,
          r.resource_class,
          r.crawl.state,
          r.crawl.value,
          r.last_crawl,
          r.errors_4xx,
          r.errors_5xx,
          r.referrals.state,
          r.referrals.value,
          r.key_events,
          r.citations.state,
          r.citations.value,
          r.findings.state,
          r.findings.value,
        ]
          .map((v) => (v === null ? '' : String(v)))
          .join(','),
      ),
    ].join('\r\n');
    const config = testConfig();
    const exportCsv = async () =>
      createApp(config, db).request(
        `/api/v1/projects/${seed.projectId}/ai-traffic/pages/export?start_date=${day}&end_date=${day}`,
        {
          headers: {
            'x-workspace-id': seed.workspaceId,
            cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: seed.userId, ver: 0 })}`,
          },
        },
      );
    const response = await exportCsv();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(expected + '\r\n');
    const bound = crawlLogs.max_export_rows;
    crawlLogs.max_export_rows = pages - 1;
    try {
      expect((await exportCsv()).status).toBe(422);
    } finally {
      crawlLogs.max_export_rows = bound;
    }
  });
  it('keeps timezone mismatches non-comparable, flagged absence unavailable, and missing connections distinct', async () => {
    await db
      .updateTable('ai_referral_landing_daily')
      .set({ reporting_timezone: 'Asia/Kolkata' })
      .where('project_id', '=', seed.projectId)
      .execute();
    const result = await pagesRead(db, scope(), filters),
      row = result.items.find((r) => r.url_hash === guide)!;
    expect([row.crawl.state, row.referrals.state]).toEqual(['non_comparable', 'non_comparable']);
    await db
      .updateTable('ai_referral_landing_daily')
      .set({ reporting_timezone: 'UTC' })
      .where('project_id', '=', seed.projectId)
      .execute();
    // Even a complete empty crawl leg has a reporting timezone to compare.
    await db
      .updateTable('crawl_log_coverage_daily')
      .set({ reporting_timezone: 'Asia/Kolkata' })
      .where('project_id', '=', seed.projectId)
      .execute();
    const quiet = (await pagesRead(db, scope(), filters)).items.find(
      (r) => r.display_path === '/quiet',
    )!;
    expect([quiet.crawl.state, quiet.referrals.state]).toEqual([
      'non_comparable',
      'non_comparable',
    ]);
    await refreshInsightWindow(db, scope(), filters);
    expect((await insightsRead(db, scope(), filters)).patterns).toEqual([]);
    expect((await insightsRead(db, scope(), filters)).coverage.notice).toContain('non-comparable');
    await db
      .updateTable('crawl_log_coverage_daily')
      .set({ reporting_timezone: 'UTC' })
      .where('project_id', '=', seed.projectId)
      .execute();
    await db
      .updateTable('integration_import_artifacts')
      .set({
        extract_metadata: JSON.stringify({ timeZone: 'UTC', analytics_quality: ['thresholding'] }),
      })
      .where('id', '=', artifactId)
      .execute();
    const flagged = await pagesRead(db, scope(), filters);
    expect(flagged.items.find((r) => r.display_path === '/quiet')?.referrals).toMatchObject({
      state: 'flagged',
      value: null,
    });
    await db
      .updateTable('integration_import_artifacts')
      .set({
        extract_metadata: JSON.stringify({
          timeZone: 'UTC',
          currencyCode: 'USD',
          analytics_quality: [],
        }),
      })
      .where('id', '=', artifactId)
      .execute();
    const missing = await fixtures.crawl();
    await fixtures.page(missing, '/known', {}, { observed: true });
    expect(
      (
        await pagesRead(
          db,
          { workspaceId: missing.workspaceId, projectId: missing.projectId },
          filters,
        )
      ).items[0],
    ).toMatchObject({
      crawl: { state: 'not_connected', value: null },
      referrals: { state: 'not_connected', value: null },
      citations: { value: null },
    });
  });
  it('retains crawler-only canonical hosts and encoded paths after raw expiry, and distinguishes unknown coverage', async () => {
    const owned = await fixtures.crawl(),
      s = { workspaceId: owned.workspaceId, projectId: owned.projectId };
    await fixtures.page(owned, '/known', {}, { observed: true });
    await db
      .insertInto('owned_domains')
      .values({
        id: randomUUID(),
        workspace_id: owned.workspaceId,
        project_id: owned.projectId,
        domain: 'news.example.test',
        created_at: new Date(),
      })
      .execute();
    const source = await createSource(db, s, owned.userId, {
      setup: 'custom',
      origin: 'https://news.example.test',
      format: 'ndjson',
    });
    expect((await pagesRead(db, s, filters)).items[0]?.crawl).toMatchObject({
      state: 'unknown',
      value: null,
    });
    const stored = await db
      .selectFrom('crawl_log_sources')
      .selectAll()
      .where('id', '=', source.id)
      .executeTakeFirstOrThrow();
    await ingest(
      db,
      stored,
      Buffer.from(
        JSON.stringify({
          timestamp: day + 'T12:00:00Z',
          host: 'news.example.test',
          path: '/a%2Fb?token=discarded',
          method: 'GET',
          status: 200,
          user_agent: 'GPTBot/1.0',
        }),
      ),
      {},
    );
    await refreshCrawlLogs(db, s, now, [day]);
    await db.deleteFrom('bot_requests').where('workspace_id', '=', owned.workspaceId).execute();
    const row = (await pagesRead(db, s, filters)).items.find((r) => r.crawl.value === 1)!;
    expect(row.canonical_url).toBe('https://news.example.test/a%2Fb');
    expect(row.url_hash).toBe(hash(row.canonical_url));
    expect(
      (await pagesRead(db, s, { ...filters, folder: row.folder })).items.map((r) => r.url_hash),
    ).toContain(row.url_hash);
    expect(
      (await pageDataset(db, s, { ...filters, url_hash: row.url_hash })).rows[0]?.ai_requests,
    ).toBe(1);
  });
  it('refuses foreign projects and off-origin MCP URLs while joining canonical path identities', async () => {
    const principal = {
      kind: 'member' as const,
      userId: seed.userId,
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
    };
    const result = await dispatchTool(
      db,
      principal,
      'read_ai_traffic_url',
      {
        project_id: seed.projectId,
        url: 'https://example.test/guide?utm_source=x#fragment',
        ...filters,
      },
      'https://app.example.test',
    );
    expect(result.state).toBe('available');
    await expect(
      dispatchTool(
        db,
        principal,
        'read_ai_traffic_url',
        { project_id: seed.projectId, url: 'https://foreign.test/guide' },
        'https://app.example.test',
      ),
    ).rejects.toThrow(/origin/);
    const foreign = await fixtures.tenant();
    await expect(
      dispatchTool(
        db,
        principal,
        'read_ai_traffic_pages',
        { project_id: foreign.projectId },
        'https://app.example.test',
      ),
    ).rejects.toThrow();
    for (const url of [
      'https://example.test/guide',
      'https://example.test/%67uide',
      'https://example.test/a%2Fb',
      'https://example.test/über',
      'https://example.test/guide?utm_source=x',
    ])
      expect(hash(canonicalPage(url)!)).toBe(canonicalIdentity(url).hash);
  });
});

describe('A3 persisted insight gates', () => {
  it('gates all four patterns on coverage/quality and stores coalesced debounced refreshes', async () => {
    const data = await pageDataset(db, scope(), { ...filters, dataset_limit: 100 }),
      quality = await pageContext(db, scope(), filters);
    const row = data.rows.find((r) => r.url_hash === guide)!;
    const examples: JoinedPage[] = [
      {
        ...row,
        url_hash: 'a',
        sessions: 0,
        verified_requests: 10,
        ai_requests: 10,
        key_events: 0,
        verified_errors: {},
      },
      {
        ...row,
        url_hash: 'b',
        sessions: 20,
        requests: null,
        verified_requests: 0,
        ai_requests: 0,
        key_events: 0,
        verified_errors: {},
      },
      {
        ...row,
        url_hash: 'c',
        sessions: 10,
        key_events: 10,
        verified_errors: { '403': 2, '429': 1, '503': 1 },
      },
    ];
    expect(insightPatterns(examples, quality).map((r) => r.pattern)).toEqual([
      'crawled_without_referrals',
      'referrals_without_recent_crawl',
      'crawler_errors_on_valuable_pages',
      'key_event_concentration',
    ]);
    expect(
      insightPatterns(examples, { ...quality, crawlComplete: false, ga4Complete: false }),
    ).toEqual([]);
    expect(insightPatterns(examples, { ...quality, ga4Complete: false })).toEqual([]);
    expect(
      insightPatterns(examples, {
        ...quality,
        quality: quality.quality.map((q) => ({ ...q, flags: ['timezone_mismatch'] })),
      }),
    ).toEqual([]);
    expect(
      insightPatterns(
        examples.map((r) => ({ ...r, referral_timezones: ['Asia/Kolkata'] })),
        quality,
      ),
    ).toEqual([]);
    await Promise.all([
      db.transaction().execute((trx) => enqueueCoalesced(trx, { ...insightsRefresh, ...scope() })),
      db.transaction().execute((trx) => enqueueCoalesced(trx, { ...insightsRefresh, ...scope() })),
    ]);
    const pending = await db
      .selectFrom('analytics_tasks')
      .selectAll()
      .where('project_id', '=', seed.projectId)
      .where('task_kind', '=', 'ai_traffic_insights_refresh')
      .where('status', '=', 'queued')
      .execute();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.available_at.getTime()).toBeGreaterThan(now.getTime());
    await db.transaction().execute((trx) =>
      enqueueCoalesced(trx, {
        ...insightsRefresh,
        ...scope(),
        now: new Date(pending[0]!.available_at.getTime() + 1000),
      }),
    );
    expect(
      (
        await db
          .selectFrom('analytics_tasks')
          .select('available_at')
          .where('id', '=', pending[0]!.id)
          .executeTakeFirstOrThrow()
      ).available_at,
    ).toEqual(pending[0]!.available_at);
    await refreshTrafficInsights(pending[0]!, context);
    const saved = await db
      .selectFrom('ai_traffic_insights')
      .select(['patterns', 'provenance'])
      .where('project_id', '=', seed.projectId)
      .where('window_end', '=', new Date(day))
      .where('window_start', '<', new Date(day))
      .execute();
    // Every preset ends on the latest day GA4 has reported, not on a day still in progress.
    expect(saved).toHaveLength(3);
    expect(saved[0]!.provenance).toHaveProperty('crawl_rollup_ids');
    expect(await insightsRead(db, scope(), { range: '30d' })).toMatchObject({
      window_end: day,
      window_start: new Date(Date.parse(day) - 29 * 86400000).toISOString().slice(0, 10),
    });
    expect((await insightsRead(db, scope(), { range: '30d' })).snapshot_id).not.toBeNull();
    await db
      .updateTable('analytics_tasks')
      .set({ status: 'running' })
      .where('id', '=', pending[0]!.id)
      .execute();
    await db
      .transaction()
      .execute((trx) => enqueueCoalesced(trx, { ...insightsRefresh, ...scope() }));
    expect(
      await db
        .selectFrom('analytics_tasks')
        .select('id')
        .where('project_id', '=', seed.projectId)
        .where('task_kind', '=', 'ai_traffic_insights_refresh')
        .where('status', '=', 'queued')
        .execute(),
    ).toHaveLength(1);
  });
  it('derives nothing for a project without GA4', async () => {
    const other = await fixtures.crawl();
    const otherScope = { workspaceId: other.workspaceId, projectId: other.projectId };
    // The request is queued like any other; the executor settles it without GA4.
    const id = await enqueueCoalesced(db, { ...insightsRefresh, ...otherScope });
    const queued = await db
      .selectFrom('analytics_tasks')
      .selectAll()
      .where('id', '=', id!)
      .executeTakeFirstOrThrow();
    await refreshTrafficInsights(queued, context);
    expect(
      await db
        .selectFrom('ai_traffic_insights')
        .select('id')
        .where('project_id', '=', other.projectId)
        .execute(),
    ).toHaveLength(0);
    expect(await insightsRead(db, otherScope, { range: '30d' })).toMatchObject({
      snapshot_id: null,
      patterns: [],
    });
  });
  it('publishes the four patterns from PostgreSQL projections and suppresses absence when quality or coverage is lost', async () => {
    const bot = await db
      .selectFrom('bot_activity_daily')
      .selectAll()
      .where('project_id', '=', seed.projectId)
      .where('url_hash', '=', guide)
      .executeTakeFirstOrThrow();
    await db
      .updateTable('bot_activity_daily')
      .set({ verification: 'verified' })
      .where('project_id', '=', seed.projectId)
      .execute();
    const url = 'https://example.test/without-referrals',
      urlHash = hash(url);
    await db
      .insertInto('bot_activity_daily')
      .values({
        ...bot,
        id: randomUUID(),
        url_hash: urlHash,
        identity_key: urlHash,
        canonical_url: url,
        display_path: '/without-referrals',
        folder: '/without-referrals',
        requests: 5,
        verification: 'verified',
        status_code: 200,
        source_batch_ids: JSON.stringify(bot.source_batch_ids),
        verification_reasons: JSON.stringify({ verified: 5 }),
      })
      .execute();
    const metric = await db
      .selectFrom('integration_metric_rows')
      .selectAll()
      .where('source_artifact_id', '=', artifactId)
      .executeTakeFirstOrThrow();
    await db
      .insertInto('integration_metric_rows')
      .values({
        ...metric,
        id: randomUUID(),
        dimension_key: ['/without-crawl', 'chatgpt.com', 'referral', 'example.test', day].join(
          ' | ',
        ),
        metrics: JSON.stringify({ sessions: 10, engagedSessions: 5, keyEvents: 0 }),
      })
      .execute();
    await refreshAiReferralsSnapshot(
      await task(db, seed, 'ai_referrals_snapshot_refresh', [day, day]),
      context,
    );
    await db.transaction().execute((trx) => refreshInsightWindow(trx, scope(), filters));
    const result = await insightsRead(db, scope(), filters);
    expect(result.patterns.map((r) => r.pattern)).toEqual([
      'crawled_without_referrals',
      'referrals_without_recent_crawl',
      'crawler_errors_on_valuable_pages',
      'key_event_concentration',
    ]);
    expect(
      result.patterns.find((r) => r.pattern === 'crawler_errors_on_valuable_pages')?.numbers
        .status_403,
    ).toBe(2);
    await db
      .updateTable('integration_import_artifacts')
      .set({
        extract_metadata: JSON.stringify({ timeZone: 'UTC', analytics_quality: ['thresholding'] }),
      })
      .where('id', '=', artifactId)
      .execute();
    await db.transaction().execute((trx) => refreshInsightWindow(trx, scope(), filters));
    expect((await insightsRead(db, scope(), filters)).patterns).toEqual([]);
    await db
      .updateTable('integration_import_artifacts')
      .set({ extract_metadata: JSON.stringify({ timeZone: 'UTC', analytics_quality: [] }) })
      .where('id', '=', artifactId)
      .execute();
    await db
      .updateTable('crawl_log_coverage_daily')
      .set({ coverage: 'partial' })
      .where('source_id', '=', sourceId)
      .execute();
    await db.transaction().execute((trx) => refreshInsightWindow(trx, scope(), filters));
    const partial = await insightsRead(db, scope(), filters);
    expect(partial.patterns.map((r) => r.pattern)).toEqual(['key_event_concentration']);
    expect(partial.coverage.notice).toBeTruthy();
  });
});
