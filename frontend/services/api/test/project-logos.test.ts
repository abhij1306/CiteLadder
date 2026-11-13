import { randomUUID } from 'node:crypto';

import { afterAll, expect, it, vi } from 'vitest';

import { policy } from '../src/config.ts';
import { setLogSink } from '../src/logging.ts';
import { projectCreate } from '../src/projects/inputs.ts';
import { refreshLogos } from '../src/projects/logo-refresh.ts';
import { createProject, updateProject } from '../src/projects/service.ts';
import type { WebsiteFetcher } from '../src/safe-fetch.ts';
import { Fixtures, ownerActor, testDatabase } from './support.ts';
import { COMPETITORS_WRITE } from '../src/commands/competitors.ts';

const db = testDatabase();
const fixtures = new Fixtures(db);
const domains: string[] = [];
afterAll(async () => {
  await fixtures.cleanup();
  if (domains.length)
    await db.deleteFrom('brand_logo_assets').where('domain', 'in', domains).execute();
  await db.destroy();
});
async function tenant(domain = `logo-${randomUUID()}.com`, website: string = domain) {
  const userId = await fixtures.user();
  const workspaceId = await fixtures.ownedWorkspace(userId);
  domains.push(domain);
  const project = await createProject(
    db,
    workspaceId,
    userId,
    projectCreate.parse({ name: 'Logo', brand_name: 'Logo', website_url: website }),
  );
  return { workspaceId, projectId: project.id, userId, domain };
}
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const brandLogo = (projectId: string) =>
  db
    .selectFrom('brands')
    .innerJoin('brand_logo_assets as asset', 'asset.id', 'brands.logo_asset_id')
    .select('asset.image_data')
    .where('brands.project_id', '=', projectId)
    .executeTakeFirst();
it('keys the shared cache by private-suffix host and fetches only that host homepage', async () => {
  const hostA = `a-${randomUUID()}.github.io`;
  const a = await tenant(hostA, `https://${hostA}/x`);
  const b = await tenant(`b-${randomUUID()}.github.io`);
  const pngFor = (host: string) => Buffer.concat([png, Buffer.from(host)]);
  const fetcher = vi.fn<WebsiteFetcher>(async (url) => {
    const { hostname, pathname } = new URL(url);
    return pathname === '/favicon.ico'
      ? { url, status: 200, contentType: 'image/png', body: pngFor(hostname) }
      : { url, status: 200, contentType: 'text/html', body: Buffer.from('<p>No icon</p>') };
  });
  await refreshLogos(db, a, fetcher);
  await refreshLogos(db, b, fetcher);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    `https://${a.domain}/`,
    `https://${a.domain}/favicon.ico`,
    `https://${b.domain}/`,
    `https://${b.domain}/favicon.ico`,
  ]);
  expect(await brandLogo(a.projectId)).toEqual({ image_data: pngFor(a.domain) });
  expect(await brandLogo(b.projectId)).toEqual({ image_data: pngFor(b.domain) });
});
it('tries the icon the homepage declares before the well-known fallback', async () => {
  const t = await tenant();
  const declared = Buffer.concat([png, Buffer.from('declared')]);
  const fetcher = vi.fn<WebsiteFetcher>(async (url) => {
    const { pathname } = new URL(url);
    if (pathname === '/brand.png')
      return { url, status: 200, contentType: 'image/png', body: declared };
    if (pathname === '/favicon.ico')
      return { url, status: 404, contentType: 'text/html', body: png };
    return {
      url,
      status: 200,
      contentType: 'text/html',
      body: Buffer.from('<head><link rel="shortcut icon" href="/brand.png"></head>'),
    };
  });
  await refreshLogos(db, t, fetcher);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    `https://${t.domain}/`,
    `https://${t.domain}/brand.png`,
  ]);
  expect(await brandLogo(t.projectId)).toEqual({ image_data: declared });
});
it('records no shared failure when the refresh deadline aborts the fetch', async () => {
  const t = await tenant();
  const stalled = vi.fn<WebsiteFetcher>(
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        if (signal?.aborted) reject(signal.reason);
        signal?.addEventListener('abort', () => reject(signal.reason));
      }),
  );
  const deadline = policy.brand_logos.refresh_timeout_seconds;
  policy.brand_logos.refresh_timeout_seconds = 0.05;
  try {
    expect((await refreshLogos(db, t, stalled)).brand.logo_url).toBeNull();
  } finally {
    policy.brand_logos.refresh_timeout_seconds = deadline;
  }
  expect(
    await db
      .selectFrom('brand_logo_assets')
      .select('status')
      .where('domain', '=', t.domain)
      .execute(),
  ).toEqual([]);
});
it('attaches ready raster assets, reuses fresh cache and retains stale success after failed refresh', async () => {
  const t = await tenant();
  const fetcher = vi.fn<WebsiteFetcher>(async (url) =>
    url.endsWith('favicon.ico')
      ? { url, status: 200, contentType: 'image/png', body: png }
      : {
          url,
          status: 200,
          contentType: 'text/html',
          body: Buffer.from('<p>No declared icon</p>'),
        },
  );
  expect((await refreshLogos(db, t, fetcher)).brand.logo_url).toContain('/logo');
  const calls = fetcher.mock.calls.length;
  await refreshLogos(db, t, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(calls);
  await db
    .updateTable('brand_logo_assets')
    .set({
      fetched_at: new Date(Date.now() - (policy.brand_logos.success_cache_seconds + 1) * 1000),
    })
    .where('domain', '=', t.domain)
    .execute();
  const failed = vi.fn<WebsiteFetcher>(async () => {
    throw new Error('recorded unavailable');
  });
  expect((await refreshLogos(db, t, failed)).brand.logo_url).toContain('/logo');
  expect(
    await db
      .selectFrom('brand_logo_assets')
      .select(['status', 'image_data'])
      .where('domain', '=', t.domain)
      .executeTakeFirstOrThrow(),
  ).toMatchObject({ status: 'ready', image_data: png });
});
it('negative caches failures and refuses to attach a result after identity changes', async () => {
  const t = await tenant();
  const failed = vi.fn<WebsiteFetcher>(async () => {
    throw new Error('recorded unavailable');
  });
  const records: Record<string, unknown>[] = [];
  const restore = setLogSink((line) => records.push(JSON.parse(line) as Record<string, unknown>));
  try {
    await refreshLogos(db, t, failed);
  } finally {
    setLogSink(restore);
  }
  // The homepage and the well-known fallback each fail with a logged cause.
  expect(
    records
      .filter((entry) => entry.event === 'brand_logo_fetch_failed')
      .map((entry) => [entry.phase, entry.error_class]),
  ).toEqual([
    ['homepage', 'Error'],
    ['icon', 'Error'],
  ]);
  const count = failed.mock.calls.length;
  await refreshLogos(db, t, failed);
  expect(failed).toHaveBeenCalledTimes(count);
  await db.deleteFrom('brand_logo_assets').where('domain', '=', t.domain).execute();
  const changed: WebsiteFetcher = async (url) => {
    await updateProject(db, ownerActor(t.workspaceId, t.userId, COMPETITORS_WRITE), t.projectId, {
      website_url: 'different.example.com',
    });
    return { url, status: 200, contentType: 'image/png', body: png };
  };
  expect((await refreshLogos(db, t, changed)).brand.logo_url).toBeNull();
});
