import { sql } from 'kysely';
import {
  detectBrandAbsentHighValuePrompt,
  detectIssueGroups,
  detectOwnedPageNotCited,
} from '../analysis/opportunities/detectors.ts';
import type { DetectorHit } from '../analysis/opportunities/evidence.ts';
import {
  buildSourceProjection,
  emptySourceProjection,
} from '../analysis/opportunities/source-mix.ts';
import { sourcePageVocabulary } from '../config/source-pages.ts';
import type { Database } from '../db/database.ts';
import { foldedRerunId } from '../site-health/reads/crawl.ts';
import { contentGapHits, contentGapSource, type ContentGapSource } from './content-gap-hits.ts';
import { earnedPageHits } from './earned-page-hits.ts';
import { internalLinkHits, internalLinkRunId } from './internal-link-hits.ts';
import { stampSourceMix, type SourceIdentity } from './refresh-compute.ts';
import { confirmedDeclineHits, loadVisibilityEvidence } from './refresh-evidence.ts';
import { changeHits, commerceHits, demandHits } from './refresh-hits.ts';
import { loadSiteEvidence } from './refresh-site-evidence.ts';
import { searchGapHits, searchGapSource, type SearchGapSource } from './search-gap-hits.ts';
import {
  currentDemandSnapshot,
  resolveAudit,
  resolveCommerceAuditId,
  resolveCommerceCatalogRevision,
  resolveCommerceMatchPassId,
  resolveCrawl,
  type AuditSource,
  type CrawlSource,
  type DemandSource,
  type Scope,
} from './sources.ts';

export type Sources = {
  at: Date;
  audit: AuditSource | null;
  commerceAuditId: string | null;
  commerceMatchPassId: string | null;
  commerceCatalogRevision: string | null;
  crawl: CrawlSource | null;
  demand: DemandSource | null;
  gaps: SearchGapSource | null;
  contentGaps: ContentGapSource;
};
type Found = {
  hits: DetectorHit[];
  limitations: string[];
  sourceMix?: Record<string, unknown>;
};
type Family = {
  identity(db: Database, scope: Scope, sources: Sources): Promise<Partial<SourceIdentity>>;
  hits(db: Database, scope: Scope, sources: Sources, identity: SourceIdentity): Promise<Found>;
  present(sources: Sources, found: Found): boolean;
  agesOut?: readonly (keyof SourceIdentity)[];
};

export async function resolveSources(db: Database, scope: Scope, at: Date): Promise<Sources> {
  return {
    at,
    audit: await resolveAudit(db, scope),
    commerceAuditId: await resolveCommerceAuditId(db, scope),
    commerceMatchPassId: await resolveCommerceMatchPassId(db, scope),
    commerceCatalogRevision: await resolveCommerceCatalogRevision(db, scope),
    crawl: await resolveCrawl(db, scope),
    demand: await currentDemandSnapshot(db, scope),
    gaps: await searchGapSource(db, scope, at),
    contentGaps: await contentGapSource(db, scope, at),
  };
}

async function sourcePagesRevision(db: Database, scope: Scope) {
  const { rows } = await sql<{ reading: string | null; pages: string | null }>`
    select
      (select id from source_page_snapshots
        where workspace_id = ${scope.workspaceId} and project_id = ${scope.projectId}
          and outcome = ${sourcePageVocabulary.INSPECTION_INSPECTED}
        order by fetched_at desc, id desc limit 1)::text as reading,
      (select max(updated_at) from source_pages
        where workspace_id = ${scope.workspaceId} and project_id = ${scope.projectId})::text as pages
  `.execute(db);
  const { reading = null, pages = null } = rows[0] ?? {};
  return reading === null && pages === null ? null : `${reading ?? ''}@${pages ?? ''}`;
}

const none = (): Found => ({ hits: [], limitations: [] });

const demand: Family = {
  identity: async (_db, _scope, { demand: snapshot }) => ({
    demand_snapshot_id: snapshot?.id ?? null,
    demand_source_revision: snapshot?.source_hash ?? null,
  }),
  hits: async (db, scope, sources) => ({
    hits: await demandHits(db, scope, sources.demand),
    limitations: [],
  }),
  present: (sources) => sources.demand !== null,
};

const visibility: Family = {
  identity: async (db, scope, { audit }) => ({
    audit_id: audit?.id ?? null,
    source_pages_revision: await sourcePagesRevision(db, scope),
  }),
  async hits(db, scope, { audit }) {
    if (audit === null) return none();
    const [evidence, metricId, limitations] = await loadVisibilityEvidence(
      db,
      scope.workspaceId,
      audit,
    );
    if (metricId === null) return none();
    let hits = [
      ...detectBrandAbsentHighValuePrompt(evidence),
      ...detectOwnedPageNotCited(evidence),
    ];
    const gaps = [
      ...new Set(
        hits.flatMap((hit) =>
          'prompt_index' in hit.evidence ? [Number(hit.evidence.prompt_index)] : [],
        ),
      ),
    ];
    const sourceMix: Record<string, unknown> = buildSourceProjection(evidence.analyses, gaps);
    stampSourceMix(audit.id, evidence.prompt_snapshots, gaps, sourceMix);
    hits.push(...(await earnedPageHits(db, scope, audit, evidence)));
    hits = hits.map((hit) => ({ ...hit, source_metric_ids: [metricId] }));
    hits.push(...(await confirmedDeclineHits(db, scope.workspaceId, audit.id)));
    return { hits, limitations, sourceMix };
  },
  present: (_sources, found) => found.sourceMix !== undefined,
};

const commerce: Family = {
  identity: async (
    _db,
    _scope,
    { commerceAuditId, commerceMatchPassId, commerceCatalogRevision },
  ) => ({
    commerce_audit_id: commerceAuditId,
    commerce_match_pass_id: commerceMatchPassId,
    commerce_catalog_revision: commerceCatalogRevision,
  }),
  hits: async (db, scope, { at, commerceAuditId, commerceMatchPassId }) =>
    commerceAuditId === null && commerceMatchPassId === null
      ? none()
      : { hits: await commerceHits(db, scope, commerceAuditId, at), limitations: [] },
  present: (sources) => sources.commerceAuditId !== null || sources.commerceMatchPassId !== null,
};

const site: Family = {
  identity: async (db, scope, { crawl }) => ({
    site_crawl_id: crawl?.id ?? null,
    site_rerun_id: crawl ? await foldedRerunId(db, crawl) : null,
    internal_link_run_id: crawl ? await internalLinkRunId(db, scope, crawl.id) : null,
  }),
  async hits(db, scope, { crawl }, identity) {
    if (crawl === null) return none();
    return {
      hits: [
        ...detectIssueGroups(await loadSiteEvidence(db, crawl)),
        ...(await internalLinkHits(db, scope, identity.internal_link_run_id)),
        ...(await changeHits(db, scope.workspaceId, crawl)),
      ],
      limitations: [],
    };
  },
  present: (sources) => sources.crawl !== null,
};

const searchGaps: Family = {
  identity: async (_db, _scope, { gaps }) => ({ search_gap_revision: gaps?.revision ?? null }),
  hits: (db, scope, { gaps, demand: snapshot, crawl }) =>
    searchGapHits(db, scope, gaps, snapshot, crawl),
  present: (sources) => sources.gaps !== null,
  agesOut: ['search_gap_revision'],
};

const contentGaps: Family = {
  identity: async (_db, _scope, { contentGaps: source }) => ({
    content_angle_run_id: source.run?.id ?? null,
  }),
  hits: (db, scope, { contentGaps: source }) => contentGapHits(db, scope, source),
  present: (sources) => sources.contentGaps.run !== null,
  agesOut: ['content_angle_run_id'],
};

const FAMILIES: readonly Family[] = [demand, visibility, commerce, site, searchGaps, contentGaps];

const EMPTY_IDENTITY: SourceIdentity = {
  audit_id: null,
  commerce_audit_id: null,
  commerce_match_pass_id: null,
  commerce_catalog_revision: null,
  site_crawl_id: null,
  site_rerun_id: null,
  demand_snapshot_id: null,
  demand_source_revision: null,
  internal_link_run_id: null,
  source_pages_revision: null,
  search_gap_revision: null,
  content_angle_run_id: null,
};

export async function sourceIdentity(
  db: Database,
  scope: Scope,
  sources: Sources,
): Promise<SourceIdentity> {
  const identity = { ...EMPTY_IDENTITY };
  for (const family of FAMILIES) Object.assign(identity, await family.identity(db, scope, sources)); // NOSONAR
  return identity;
}

export function readAgingSource(read: Record<string, unknown>): boolean {
  return FAMILIES.some((family) => family.agesOut?.some((field) => Boolean(read[field])));
}

export async function collectFamilies(
  db: Database,
  scope: Scope,
  sources: Sources,
  identity: SourceIdentity,
) {
  const hits: DetectorHit[] = [];
  const limitations: string[] = [];
  let sourceMix: Record<string, unknown> | null = null;
  let present = false;
  for (const family of FAMILIES) {
    const found = await family.hits(db, scope, sources, identity); // NOSONAR
    hits.push(...found.hits);
    limitations.push(...found.limitations);
    if (found.sourceMix) sourceMix = found.sourceMix;
    present ||= family.present(sources, found);
  }
  return {
    hits,
    limitations,
    sourceMix: sourceMix ?? emptySourceProjection(),
    audit: sourceMix === null ? null : sources.audit,
    present,
  };
}
