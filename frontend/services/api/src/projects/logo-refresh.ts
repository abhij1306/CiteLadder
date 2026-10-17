import { createHash, randomUUID } from 'node:crypto';

import { getDomain } from 'tldts';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { acquireProjectLock } from '../prompts/locks.ts';
import type { ProjectScope } from './brand-profile.ts';
import { extractPage } from './html-evidence.ts';
import { fetchWebsite, websiteIdentity, type WebsiteFetcher } from './safe-fetch.ts';
import { readProject } from './service.ts';

const cfg = policy.brand_logos;
export function rasterType(body: Buffer): string | null {
  if (body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (body.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(body.subarray(0, 6).toString())) return 'image/gif';
  if (body.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) return 'image/x-icon';
  if (body.subarray(0, 4).toString() === 'RIFF' && body.subarray(8, 12).toString() === 'WEBP')
    return 'image/webp';
  return null;
}
async function fetchLogo(url: string, fetcher: WebsiteFetcher, signal: AbortSignal) {
  let base = url;
  let icons: string[] = [];
  try {
    const page = await fetcher(url, {
      maxBytes: cfg.max_html_bytes,
      timeoutSeconds: cfg.request_timeout_seconds,
      redirects: cfg.max_redirects,
      contentTypes: policy.brand_evidence.content_types,
      domain: websiteIdentity(url).domain,
      signal,
    });
    if (page.status >= 200 && page.status < 300) {
      base = page.url;
      icons = extractPage(page.body, base).icons;
    }
  } catch {
    /* The well-known fallback can still work when the homepage cannot. */
  }
  const candidates = [
    ...new Set([...icons.slice(0, cfg.max_candidates - 1), new URL(cfg.fallback_path, base).href]),
  ];
  for (const candidate of candidates) {
    try {
      const result = await fetcher(candidate, {
        maxBytes: cfg.max_image_bytes,
        timeoutSeconds: cfg.request_timeout_seconds,
        redirects: cfg.max_redirects,
        contentTypes: cfg.image_content_types,
        signal,
      });
      const type = rasterType(result.body);
      if (result.status >= 200 && result.status < 300 && type)
        return { ...result, contentType: type };
    } catch {
      /* Only validated raster bytes become a ready cache asset. */
    }
  }
  return null;
}
type Target = { domain: string; url: string; brandId: string | null; competitorIds: string[] };
async function attach(db: Database, scope: ProjectScope, target: Target, assetId: string) {
  // Recheck the identity after network I/O: an editor may have changed it.
  const project = await db
    .selectFrom('projects')
    .select('website_url')
    .where('id', '=', scope.projectId)
    .where('workspace_id', '=', scope.workspaceId)
    .executeTakeFirst();
  if (!project) return;
  if (target.brandId && logoKey(project.website_url) === target.domain)
    await db
      .updateTable('brands')
      .set({ logo_asset_id: assetId, updated_at: new Date() })
      .where('id', '=', target.brandId)
      .where('project_id', '=', scope.projectId)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('projects')
            .select('id')
            .where('id', '=', scope.projectId)
            .where('workspace_id', '=', scope.workspaceId),
        ),
      )
      .execute();
  // The caller holds the project lock on one transaction connection; keep reads and writes ordered.
  for (const id of target.competitorIds) {
    const competitor = await db
      .selectFrom('competitors')
      .select(['id', 'domains'])
      .where('id', '=', id)
      .where('project_id', '=', scope.projectId)
      .executeTakeFirst();
    if (
      !competitor ||
      !Array.isArray(competitor.domains) ||
      !competitor.domains.some(
        (domain) => typeof domain === 'string' && logoKey(domain) === target.domain,
      )
    )
      continue;
    await db
      .updateTable('competitors')
      .set({ logo_asset_id: assetId, updated_at: new Date() })
      .where('id', '=', id)
      .where('project_id', '=', scope.projectId)
      .execute();
  }
}
/**
 * The global cache key for a website's logo: its registrable domain with private
 * suffixes honoured, so `a.github.io` and `b.github.io` never share an asset
 * while `www.example.com` still shares `example.com`'s.
 */
function logoKey(value: string) {
  try {
    const { url } = websiteIdentity(value);
    return getDomain(new URL(url).hostname, { allowPrivateDomains: true });
  } catch {
    return null;
  }
}
export async function refreshLogos(db: Database, scope: ProjectScope, fetcher = fetchWebsite) {
  const project = await readProject(db, scope);
  const brand = await db
    .selectFrom('brands')
    .select('id')
    .where('project_id', '=', scope.projectId)
    .executeTakeFirst();
  const targets = new Map<string, Target>();
  function add(value: string, brandId: string | null, competitorId: string | null) {
    const domain = logoKey(value);
    if (!domain) return;
    // Only the keyed host's own homepage decides the shared asset, never a requester's path.
    const target = targets.get(domain) ?? {
      domain,
      url: `https://${domain}/`,
      brandId,
      competitorIds: [],
    };
    if (competitorId) target.competitorIds.push(competitorId);
    targets.set(domain, target);
  }
  if (brand) add(project.website_url, brand.id, null);
  for (const competitor of project.competitors) {
    const domain = competitor.domains.find((value) => logoKey(value));
    if (domain) add(domain, null, competitor.id);
  }
  if (!targets.size) return project;
  const cached = await db
    .selectFrom('brand_logo_assets')
    .selectAll()
    .where('domain', 'in', [...targets.keys()])
    .execute();
  const now = new Date();
  const missing: Target[] = [];
  await db.transaction().execute(async (trx) => {
    await acquireProjectLock(trx, scope.projectId);
    // Attach cached assets serially on the same locked transaction connection.
    for (const target of targets.values()) {
      const asset = cached.find((item) => item.domain === target.domain);
      if (asset?.status === cfg.status_ready && asset.image_data) {
        await attach(trx, scope, target, asset.id);
        if (
          !asset.fetched_at ||
          now.getTime() - asset.fetched_at.getTime() >= cfg.success_cache_seconds * 1000
        )
          missing.push(target);
      } else if (!asset?.retry_after || asset.retry_after <= now) missing.push(target);
    }
  });
  const signal = AbortSignal.timeout(cfg.refresh_timeout_seconds * 1000);
  // Batch to enforce the configured concurrency while sharing one deadline.
  for (let offset = 0; offset < missing.length; offset += cfg.fetch_concurrency) {
    if (signal.aborted) break;
    const outcomes = await Promise.all(
      missing
        .slice(offset, offset + cfg.fetch_concurrency)
        .map(async (target) => ({ target, logo: await fetchLogo(target.url, fetcher, signal) })),
    );
    await db.transaction().execute(async (trx) => {
      await acquireProjectLock(trx, scope.projectId);
      // Persist each asset before reading its ID and attaching it on this transaction connection.
      for (const { target, logo } of outcomes) {
        // A miss under this request's own deadline says nothing about the host;
        // it must not become a shared failure that blocks every tenant's retry.
        if (!logo && signal.aborted) continue;
        const at = new Date();
        const values = {
          status: logo ? cfg.status_ready : cfg.status_failed,
          source_url: logo?.url ?? '',
          content_type: logo?.contentType ?? '',
          image_data: logo?.body ?? null,
          byte_size: logo?.body.length ?? 0,
          sha256: logo ? createHash('sha256').update(logo.body).digest('hex') : '',
          fetched_at: at,
          retry_after: logo ? null : new Date(at.getTime() + cfg.failure_cache_seconds * 1000),
          updated_at: at,
        };
        await trx
          .insertInto('brand_logo_assets')
          .values({ id: randomUUID(), domain: target.domain, ...values, created_at: at })
          .onConflict((conflict) => {
            const update = conflict.column('domain').doUpdateSet(values);
            return logo ? update : update.where('brand_logo_assets.status', '!=', cfg.status_ready);
          })
          .execute();
        const asset = await trx
          .selectFrom('brand_logo_assets')
          .select(['id', 'status'])
          .where('domain', '=', target.domain)
          .executeTakeFirstOrThrow();
        if (asset.status === cfg.status_ready) await attach(trx, scope, target, asset.id);
      }
    });
  }
  return readProject(db, scope);
}
