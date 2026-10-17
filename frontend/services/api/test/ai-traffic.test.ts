/**
 * The persisted AI Referrals read over HTTP.
 *
 * A preset resolves the snapshot its
 * refresh MARKED, never one of merely the right length; an exact window reads
 * only that window; a bad query is a 422; another workspace sees a 404.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { policy } from '../src/config.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

const config = testConfig();
const db = testDatabase(config);
const fixtures = new VisibilityFixtures(db);
const app = createApp(config, db);

function isoDaysAgo(days: number, from = new Date()): string {
  return new Date(from.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

async function referrals(
  tenant: Tenant | null,
  projectId: string,
  query: Record<string, string> = {},
) {
  const headers: Record<string, string> = {};
  if (tenant) {
    headers.cookie = `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: tenant.userId, ver: 0 })}`;
  }
  const search = new URLSearchParams(query);
  const response = await app.request(
    `/api/v1/projects/${projectId}/ai-traffic/referrals${search.size ? `?${search}` : ''}`,
    { headers },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

let tenant: Tenant;

beforeAll(async () => {
  tenant = await fixtures.tenant();
});

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

describe('GET /projects/{project_id}/ai-traffic', () => {
  it('is not found to a non-member', async () => {
    expect((await referrals(null, tenant.projectId)).status).toBe(404);
  });

  it('serves the empty projection, and nothing to another workspace', async () => {
    const empty = await fixtures.tenant();
    const { status, body } = await referrals(empty, empty.projectId);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      project_id: empty.projectId,
      window_start: '',
      window_end: '',
      granularity: 'day',
      referral_volume: [],
      referral_share: [],
      sources: [],
      landing_pages: [],
      channel_comparison: [],
      analyzer_version: policy.analytics.ai_referral_analyzer_version,
      formula_version: policy.analytics.ai_referral_formula_version,
    });
    expect((await referrals(tenant, empty.projectId)).status).toBe(404);
    const retired = await app.request(`/api/v1/projects/${empty.projectId}/ai-referrals`, {
      headers: {
        cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: empty.userId, ver: 0 })}`,
      },
    });
    expect(retired.status).toBe(404);
  });

  it('resolves a preset to its marked snapshot, however stale its end date', async () => {
    const own = await fixtures.tenant();
    const end = isoDaysAgo(9);
    const start = isoDaysAgo(29, new Date(`${end}T00:00:00Z`));
    await fixtures.referralSnapshot(own, {
      windowStart: start,
      windowEnd: end,
      sessions: 42,
      presetDays: 30,
    });

    const { body } = await referrals(own, own.projectId, { range: '30d' });
    expect(body).toMatchObject({ window_start: start, window_end: end });
    expect(body.sources).toEqual([{ ai_source: 'chatgpt', sessions: 42, share: null }]);
    expect(body.referral_volume).toEqual([{ date: end, value: 42 }]);

    // The window a client clock would send still matches nothing.
    const clientWindow = await referrals(own, own.projectId, {
      from: isoDaysAgo(29),
      to: isoDaysAgo(0),
    });
    expect(clientWindow.body.sources).toEqual([]);
    // Another preset's length is a different range.
    expect((await referrals(own, own.projectId, { range: '90d' })).body.sources).toEqual([]);
  });

  it('never answers a preset with an unmarked window of the same length', async () => {
    const own = await fixtures.tenant();
    const end = isoDaysAgo(3);
    const start = isoDaysAgo(29, new Date(`${end}T00:00:00Z`));
    await fixtures.referralSnapshot(own, { windowStart: start, windowEnd: end, sessions: 11 });

    expect((await referrals(own, own.projectId, { range: '30d' })).body.sources).toEqual([]);
    const exact = await referrals(own, own.projectId, { from: start, to: end });
    expect(exact.body.sources).toEqual([{ ai_source: 'chatgpt', sessions: 11, share: null }]);
    // With neither, the latest persisted snapshot serves the landing view.
    expect((await referrals(own, own.projectId)).body.window_end).toBe(end);
  });

  it('rejects a malformed query with 422 and accepts the widest window', async () => {
    const maxDays = policy.analytics.max_window_days;
    const end = '2026-07-22';
    const invalid: Record<string, string>[] = [
      { granularity: 'hourly' },
      { range: '7d' },
      { from: '2026-07-22', to: '2026-07-20' },
      { from: '2026-07-20' },
      { from: isoDaysAgo(maxDays, new Date(`${end}T00:00:00Z`)), to: end },
      { from: 'not-a-date', to: end },
    ];
    for (const query of invalid) {
      const { status, body } = await referrals(tenant, tenant.projectId, query);
      expect(status).toBe(422);
      expect(body.error).toMatchObject({ code: 'validation_error', retryable: false });
    }
    const unknown = await referrals(tenant, tenant.projectId, { range: '7d' });
    expect(unknown.body.error).toMatchObject({ code: 'validation_error', retryable: false });

    const widest = { from: isoDaysAgo(maxDays - 1, new Date(`${end}T00:00:00Z`)), to: end };
    expect((await referrals(tenant, tenant.projectId, widest)).status).toBe(200);
  });
});
