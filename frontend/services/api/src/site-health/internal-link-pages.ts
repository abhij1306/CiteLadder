import { sql } from 'kysely';
import { internalLinkPageSchema, type InternalLinkPage } from '@citeladder/contracts/site-health';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record, strings } from '../db/json.ts';
import { sourcePassages } from './internal-link-placements.ts';
import { loadCrawl, pageAuditsSql } from './reads/crawl.ts';

export type LinkScope = { workspaceId: string; projectId: string };
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const trackingParams = new Set<string>(policy.internal_links.tracking_params);
const isTracking = (name: string) =>
  trackingParams.has(name) ||
  policy.internal_links.tracking_param_prefixes.some((prefix) => name.startsWith(prefix));

export function linkUrl(value: string, base: string): string | null {
  try {
    const url = new URL(value, base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    for (const name of Array.from(url.searchParams.keys()))
      if (isTracking(name.toLowerCase())) url.searchParams.delete(name);
    return url.href;
  } catch {
    return null;
  }
}

function linkedTargets(facts: Record<string, unknown>, url: string) {
  const links = record(facts.links);
  const targets = new Set<string>();
  const anchors = Array.isArray(links.anchors) ? links.anchors : [];
  for (const raw of anchors) {
    const anchor = record(raw);
    if (anchor.is_internal !== true) continue;
    const target = linkUrl(text(anchor.url), url);
    if (!target) continue;
    if (!['nav', 'header', 'footer', 'aside'].includes(text(anchor.region))) targets.add(target);
  }
  return { contextual_targets: [...targets], links_complete: links.anchors_truncated === false };
}

async function contextualInbound(db: Database, scope: LinkScope, crawlId: string) {
  const rows = await db
    .selectFrom('site_page_link_metrics')
    .select(['site_url_id', 'main_content_inbound_count'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('crawl_id', '=', crawlId)
    .orderBy('created_at')
    .execute();
  return new Map(rows.map((row) => [row.site_url_id, row.main_content_inbound_count]));
}

export async function loadLinkPages(db: Database, scope: LinkScope, crawlId: string) {
  const crawl = await loadCrawl(db, scope.workspaceId, crawlId);
  const query = db
    .selectFrom('site_page_analyses as analysis')
    .innerJoin('site_fetch_artifacts as artifact', 'artifact.id', 'analysis.artifact_id')
    .innerJoin('site_urls as url', 'url.id', 'analysis.site_url_id')
    .where('analysis.workspace_id', '=', scope.workspaceId)
    .where('analysis.project_id', '=', scope.projectId)
    .where(
      'analysis.id',
      'in',
      sql<string>`(select v.analysis_id from (${pageAuditsSql(crawl)}) v)`,
    )
    .where('artifact.workspace_id', '=', scope.workspaceId)
    .where('url.workspace_id', '=', scope.workspaceId)
    .where('url.project_id', '=', scope.projectId)
    .where('analysis.finalized_at', 'is not', null)
    .where(sql<boolean>`artifact.normalized_facts #>> '{extraction,state}' = 'available'`)
    .where(
      sql<boolean>`artifact.normalized_facts #> '{extraction,truncated}' is distinct from 'true'::jsonb`,
    )
    .where('analysis.page_kind', 'not in', [...policy.internal_links.excluded_page_kinds]);
  const total = await query
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .executeTakeFirstOrThrow();
  const rows = await query
    .select([
      'analysis.id',
      'analysis.artifact_id',
      'analysis.site_url_id',
      'analysis.main_content_indexable',
      'analysis.page_kind',
      'artifact.normalized_facts',
      'artifact.final_url',
      'url.normalized_url',
    ])
    .orderBy(sql`analysis.main_content_indexable desc nulls last`)
    .orderBy(sql`md5(url.normalized_url)`)
    .orderBy('url.normalized_url')
    .limit(policy.internal_links.max_pages)
    .execute();
  const inbound = await contextualInbound(db, scope, crawlId);
  const pages: InternalLinkPage[] = [];
  const urls = new Set<string>();
  for (const row of rows) {
    const facts = record(row.normalized_facts);
    const url = linkUrl(row.final_url || row.normalized_url, row.normalized_url);
    if (!url || urls.has(url)) continue;
    urls.add(url);
    const sourceText = facts.primary_content_text;
    const headings = Array.isArray(facts.primary_heading_outline)
      ? facts.primary_heading_outline.map((heading) => text(record(heading).text))
      : [];
    const source_passages =
      facts.primary_content_truncated === true || typeof sourceText !== 'string'
        ? null
        : sourcePassages(sourceText, headings);
    pages.push(
      internalLinkPageSchema.parse({
        analysis_id: row.id,
        artifact_id: row.artifact_id,
        site_url_id: row.site_url_id,
        url,
        title: text(facts.title),
        h1: text(strings(record(facts.headings).h1_texts)[0]),
        description: text(facts.meta_description),
        excerpt: text(facts.primary_content_text).slice(0, policy.internal_links.max_excerpt_chars),
        source_passages,
        page_kind: row.page_kind,
        contextual_inbound: inbound.get(row.site_url_id) ?? null,
        ...linkedTargets(facts, url),
        eligible_target: row.main_content_indexable === true,
        extractor_version: text(facts.extractor_version),
      }),
    );
  }
  return { pages, omittedPages: Math.max(0, Number(total.count) - rows.length) };
}
