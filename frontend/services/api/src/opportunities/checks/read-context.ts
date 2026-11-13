/** What one source's reading of a declaration shares across its checks. */
import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import type { WorkspaceScope } from '../../db/workspace-scope.ts';
import { parseUuid } from '../../http/uuid.ts';
import { foldingSiteCrawl, pageAuditsSql } from '../../site-health/reads/crawl.ts';
import type { Evaluation, Reading } from '../verification-decisions.ts';
import type { Declaration } from '../verification-result.ts';
import type { SourceKind } from './kind.ts';

export type Source = { kind: SourceKind; id: string; observed_at: string };
export type ReadContext = {
  db: Database;
  scope: WorkspaceScope;
  declaration: Declaration;
  result: Evaluation;
  reading: Reading;
  /** One read per page, snapshot or row a declaration's checks share. */
  reads: Map<string, Promise<unknown>>;
};

export function once<T>(ctx: ReadContext, key: string, read: () => Promise<T>): Promise<T> {
  if (!ctx.reads.has(key)) ctx.reads.set(key, read());
  return ctx.reads.get(key) as Promise<T>;
}

export const dayOf = (iso: string) => iso.slice(0, 10);

/**
 * The analyses a reading of the crawl sees, as an `in` list: each page's
 * latest audit as the crawl shows it (`pageAuditsSql`, SH-B9). `fold` reads a
 * page rerun through the site crawl it lands in, so a check across many pages
 * sees every tracked page; otherwise a rerun shows its own page.
 */
export async function latestAudits(
  ctx: ReadContext,
  crawlId: string,
  { page, fold = false }: { page?: string; fold?: boolean } = {},
) {
  const crawl = await once(ctx, `crawl:${crawlId}`, () =>
    ctx.scope
      .selectFrom(ctx.db, 'site_crawls')
      .selectAll()
      .where('id', '=', crawlId)
      .executeTakeFirst(),
  );
  if (!crawl) return sql<string>`(select null::uuid where false)`;
  const view = fold
    ? ((await once(ctx, `folding:${crawlId}`, () => foldingSiteCrawl(ctx.db, crawl))) ?? crawl)
    : crawl;
  const one = page === undefined ? undefined : sql`${page}::uuid`;
  return sql<string>`(select v.analysis_id from (${pageAuditsSql(view, one)}) v)`;
}

type SiteAnalysis = {
  id: string;
  normalized_facts: unknown;
  source_evaluation_ids: unknown;
};

/**
 * The declared page's latest audit as this crawl shows it (`latestAudits`),
 * fetched after go-live; a check without its own page reads the declaration's
 * only target.
 */
export async function pageAnalysis(
  ctx: ReadContext,
  crawlId: string,
  targetSiteUrlId: string | undefined,
): Promise<SiteAnalysis | 'no_resolved_target' | 'page_not_analyzed'> {
  const d = ctx.declaration;
  const targets = Array.isArray(d.target_site_url_ids) ? d.target_site_url_ids : [];
  const target = parseUuid(targetSiteUrlId ?? (targets.length === 1 ? targets[0] : null));
  if (!target) return 'no_resolved_target';
  const analysis = await once(ctx, `analysis:${target}`, async () =>
    ctx.scope
      .selectFrom(ctx.db, 'site_page_analyses')
      .innerJoin(
        'site_fetch_artifacts',
        'site_fetch_artifacts.id',
        'site_page_analyses.artifact_id',
      )
      .select([
        'site_page_analyses.id',
        'site_page_analyses.source_evaluation_ids',
        'site_fetch_artifacts.normalized_facts',
      ])
      .where('site_fetch_artifacts.workspace_id', '=', d.workspace_id)
      .where('site_page_analyses.project_id', '=', d.project_id)
      .where('site_page_analyses.id', 'in', await latestAudits(ctx, crawlId, { page: target }))
      .where('site_page_analyses.finalized_at', 'is not', null)
      .where(
        'site_fetch_artifacts.fetched_at',
        '>',
        sql<Date>`${d.declared_implemented_at}::timestamptz`,
      )
      .orderBy('site_page_analyses.created_at', 'desc')
      .orderBy('site_page_analyses.id', 'desc')
      .limit(1)
      .executeTakeFirst(),
  );
  return analysis ?? 'page_not_analyzed';
}
