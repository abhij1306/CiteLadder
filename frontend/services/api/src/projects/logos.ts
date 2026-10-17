/**
 * Cached brand and competitor logos, served to the browser's `<img>`.
 *
 * The logo refresh fetches and caches assets through the safe
 * fetcher); these reads serve a ready asset with validators, sandboxed so an
 * image can never run as a document.
 */
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { notFound } from '../errors.ts';
import type { ProjectScope } from './brand-profile.ts';

const { status_ready: READY, cache_max_age_seconds: MAX_AGE } = policy.brand_logos;

export function brandLogoUrl(projectId: string): string {
  return `${policy.api.prefix}/projects/${projectId}/logo`;
}

export function competitorLogoUrl(projectId: string, competitorId: string): string {
  return `${policy.api.prefix}/projects/${projectId}/competitors/${competitorId}/logo`;
}

/** The project's brand logo, or the competitor's when `competitorId` is set. */
export async function logoResponse(
  db: Database,
  scope: ProjectScope,
  competitorId: string | null,
  ifNoneMatch: string | undefined,
): Promise<Response> {
  const owner =
    competitorId === null
      ? db
          .selectFrom('brands as owner')
          .innerJoin('projects', 'projects.id', 'owner.project_id')
          .where('projects.id', '=', scope.projectId)
      : db
          .selectFrom('competitors as owner')
          .innerJoin('projects', 'projects.id', 'owner.project_id')
          .where('projects.id', '=', scope.projectId)
          .where('owner.id', '=', competitorId);
  const asset = await owner
    .innerJoin('brand_logo_assets as asset', 'asset.id', 'owner.logo_asset_id')
    .select(['asset.image_data', 'asset.content_type', 'asset.sha256'])
    .where('projects.workspace_id', '=', scope.workspaceId)
    .where('asset.status', '=', READY)
    .where('asset.image_data', 'is not', null)
    .executeTakeFirst();
  if (asset?.image_data == null)
    throw notFound(competitorId === null ? 'Brand logo' : 'Competitor logo');
  const etag = `"${asset.sha256}"`;
  const headers = {
    'cache-control': `private, max-age=${MAX_AGE}`,
    'content-disposition': 'inline',
    'content-security-policy': "default-src 'none'; sandbox",
    etag,
    'x-content-type-options': 'nosniff',
  };
  if (ifNoneMatch === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(asset.image_data), {
    headers: { ...headers, 'content-type': asset.content_type },
  });
}
