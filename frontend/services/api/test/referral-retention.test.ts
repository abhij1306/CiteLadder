/**
 * AI referral retention follows the Performance window (OD7): the sweep keeps
 * referral evidence Performance can still read, so an in-window AI session is
 * still counted as AI after a sweep, and deletes only what is older.
 */
import { afterAll, beforeEach, expect, it } from 'vitest';

import { classifyReferrals } from '../src/referrals/classify.ts';
import { ingestReferrals } from '../src/referrals/ingest.ts';
import { referralRetentionSweep } from '../src/referrals/retention.ts';
import { refreshTrafficSnapshot } from '../src/traffic/snapshot.ts';
import { seedImport, seedMetricRow, SOURCE_MEDIUM_DAILY } from './referral-fixtures.ts';
import { asOwner, Fixtures, testDatabase } from './support.ts';
import { requests, task, tenant, type Tenant } from './traffic-fixtures.ts';

const db = testDatabase();
const fixtures = new Fixtures(db);
const context = { db, maxAttempts: 3, checkCancelled: async () => {} };
const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
let t: Tenant;

beforeEach(async () => {
  t = await tenant(db, fixtures);
});

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

it('keeps a 200-day-old AI referral counted in Performance and deletes one older than 480 days', async () => {
  const inWindow = daysAgo(200);
  // The first day of a 480-day Performance window ending yesterday.
  const firstDay = daysAgo(480);
  const expired = daysAgo(481);
  const seed = await seedImport(db, {
    ...t,
    dataset: SOURCE_MEDIUM_DAILY,
    window: [expired, daysAgo(0)],
  });
  await asOwner((owner) =>
    owner
      .updateTable('integration_import_artifacts')
      .set({
        extract_metadata: JSON.stringify({
          timeZone: 'UTC',
          currencyCode: 'USD',
          analytics_quality: [],
          truncated: false,
        }),
      })
      .where('id', '=', seed.artifactId)
      .execute(),
  );
  for (const [date, sessions] of [
    [inWindow, 7],
    [firstDay, 2],
    [expired, 3],
  ] as const)
    await seedMetricRow(db, seed, {
      date,
      values: ['chatgpt.com', 'referral', date],
      sessions,
    });
  const ingest = {
    ...(await task(db, t, 'ingest_referrals', [expired, inWindow])),
    payload: { import_artifact_id: seed.artifactId },
  };
  await ingestReferrals(ingest, context);
  await classifyReferrals({ ...ingest, task_kind: 'classify_referrals' }, context);

  await referralRetentionSweep(
    {
      ...(await task(db, t, 'referral_retention_sweep')),
      project_id: null,
      payload: { sweep_key: daysAgo(0) },
    },
    context,
  );

  const kept = await db
    .selectFrom('referral_events')
    .innerJoin(
      'referral_classifications',
      'referral_classifications.referral_event_id',
      'referral_events.id',
    )
    .select(['referral_events.occurred_at', 'referral_classifications.ai_source'])
    .where('referral_events.workspace_id', '=', t.workspaceId)
    .orderBy('referral_events.occurred_at')
    .execute();
  expect(
    kept.map((row) => ({
      day: row.occurred_at.toISOString().slice(0, 10),
      ai_source: row.ai_source,
    })),
  ).toEqual([
    { day: firstDay, ai_source: 'chatgpt' },
    { day: inWindow, ai_source: 'chatgpt' },
  ]);

  await refreshTrafficSnapshot(
    await task(db, t, 'traffic_snapshot_refresh', [inWindow, inWindow]),
    context,
  );
  const performance = await requests(
    db,
    t,
  )(`performance?range=custom&from=${inWindow}&to=${inWindow}`);
  expect(performance.body.selected.totals.sessions).toBe(7);
});
