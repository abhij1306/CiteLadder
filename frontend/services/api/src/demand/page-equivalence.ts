/** Page equivalence needs recorded redirect/canonical proof; variants alone abstain. */
import type { Database } from '../db/database.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { policy } from '../config.ts';
import { canonicalPage } from '../traffic/normalization.ts';
import { record } from '../db/json.ts';
import { compareText, scalarText, stripTrailing } from '../text-order.ts';
import { onlyOf } from '../lists.ts';

const p = policy.demand;
type PageCandidate = {
  site_url_id: string;
  normalized_url: string;
  evidence: string[];
  sitemap_member: boolean;
  preferred_origin: boolean;
};
export type PageResolution = {
  outcome: string;
  site_url_id: string | null;
  candidates: PageCandidate[];
  resolver_version: string;
};
type PageArtifact = {
  requested_url: string;
  final_url: string;
  normalized_facts: unknown;
  site_url_id: string | null;
};
const resolution = (
  outcome: string,
  id: string | null,
  candidates: PageCandidate[],
): PageResolution => ({
  outcome,
  site_url_id: id,
  candidates,
  resolver_version: p.PAGE_EQUIVALENCE_RESOLVER_VERSION,
});

function variants(canonical: string): string[] {
  const url = new URL(canonical);
  const host = url.hostname;
  const hosts = [host, host.startsWith('www.') ? host.slice(4) : `www.${host}`];
  const paths =
    url.pathname === '/'
      ? ['/']
      : [
          url.pathname,
          url.pathname.endsWith('/') ? stripTrailing(url.pathname, '/') : `${url.pathname}/`,
        ];
  return [
    ...new Set(
      ['http', 'https']
        .flatMap((scheme) =>
          hosts.flatMap((h) =>
            paths.map((path) => canonicalPage(`${scheme}://${h}${path}${url.search}`)),
          ),
        )
        .filter((v): v is string => v !== null),
    ),
  ].sort(compareText);
}

function resolveFromArtifacts(
  requested: string,
  candidates: PageCandidate[],
  artifacts: PageArtifact[],
): PageResolution {
  const enriched = candidates.map((c) => ({ ...c, evidence: [] as string[] }));
  for (const candidate of enriched) {
    const proofs = new Set<string>();
    for (const artifact of artifacts) {
      const source = canonicalPage(artifact.requested_url);
      const final = canonicalPage(artifact.final_url);
      if (source === requested && final === candidate.normalized_url && final !== source)
        proofs.add('redirect');
      const declared = canonicalPage(scalarText(record(artifact.normalized_facts).canonical_url));
      const sourceMatches =
        source === requested ||
        candidates.some(
          (c) => c.site_url_id === artifact.site_url_id && c.normalized_url === requested,
        );
      if (sourceMatches && declared === candidate.normalized_url && declared !== requested)
        proofs.add('canonical');
    }
    candidate.evidence = [...proofs].sort(compareText);
  }
  const proven = enriched.filter((c) => c.evidence.length);
  enriched.sort(
    (a, b) =>
      Number(b.sitemap_member) - Number(a.sitemap_member) ||
      Number(b.preferred_origin) - Number(a.preferred_origin) ||
      compareText(a.normalized_url, b.normalized_url) ||
      compareText(a.site_url_id, b.site_url_id),
  );
  const only = onlyOf(proven);
  return resolution(only ? 'resolved' : 'ambiguous', only?.site_url_id ?? null, enriched);
}

export async function resolveOwnedPages(
  db: Database,
  workspaceId: string,
  projectId: string,
  urls: string[],
  preferredOrigin = '',
): Promise<Map<string, PageResolution>> {
  const scope = new WorkspaceScope(workspaceId);
  const canonical = new Map(urls.map((url) => [url, canonicalPage(url)]));
  const variantsByUrl = new Map([...canonical].map(([raw, c]) => [raw, c ? variants(c) : []]));
  const all = [...new Set([...variantsByUrl.values()].flat())].sort(compareText);
  const rows = new Map<
    string,
    { id: string; normalized_url: string; latest_source_kind: string | null }
  >();
  for (let i = 0; i < all.length; i += p.PAGE_EQUIVALENCE_QUERY_CHUNK_SIZE) {
    const batch = await scope
      .selectFrom(db, 'site_urls')
      .select(['id', 'normalized_url', 'latest_source_kind'])
      .where('project_id', '=', projectId)
      .where('normalized_url', 'in', all.slice(i, i + p.PAGE_EQUIVALENCE_QUERY_CHUNK_SIZE))
      .orderBy('normalized_url')
      .orderBy('id')
      .execute();
    for (const row of batch) rows.set(row.normalized_url, row);
  }
  const preferred = canonicalPage(preferredOrigin);
  const result = new Map<string, PageResolution>();
  const pending = new Map<string, PageCandidate[]>();
  const ids = new Set<string>();
  for (const url of urls) {
    const candidates = (variantsByUrl.get(url) ?? [])
      .flatMap((v) => (rows.has(v) ? [rows.get(v)!] : []))
      .slice(0, p.PAGE_EQUIVALENCE_MAX_CANDIDATES)
      .map((r) => ({
        site_url_id: r.id,
        normalized_url: r.normalized_url,
        evidence: [],
        sitemap_member: r.latest_source_kind === 'sitemap',
        preferred_origin:
          !!preferred &&
          (r.normalized_url === preferred ||
            r.normalized_url.startsWith(`${stripTrailing(preferred, '/')}/`)),
      }));
    const exact = candidates.find((c) => c.normalized_url === canonical.get(url));
    if (exact) result.set(url, resolution('exact', exact.site_url_id, candidates));
    else if (!candidates.length) result.set(url, resolution('unresolved', null, []));
    else {
      pending.set(url, candidates);
      for (const c of candidates) ids.add(c.site_url_id);
    }
  }
  const artifacts = ids.size
    ? await db
        .selectFrom('site_fetch_artifacts as artifact')
        .innerJoin('site_crawl_tasks as task', 'task.id', 'artifact.task_id')
        .select([
          'artifact.requested_url',
          'artifact.final_url',
          'artifact.normalized_facts',
          'task.site_url_id',
        ])
        .where('artifact.workspace_id', '=', workspaceId)
        .where('task.workspace_id', '=', workspaceId)
        .where('task.site_url_id', 'in', [...ids])
        .orderBy('artifact.created_at', 'desc')
        .orderBy('artifact.id', 'desc')
        .limit(p.PAGE_EQUIVALENCE_MAX_ARTIFACTS)
        .execute()
    : [];
  for (const [url, candidates] of pending)
    result.set(url, resolveFromArtifacts(canonical.get(url)!, candidates, artifacts));
  return result;
}
