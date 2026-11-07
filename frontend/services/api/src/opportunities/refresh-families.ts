/**
 * The Opportunity families a refresh reads. Each names the source identity
 * its hits depend on and produces its hits from persisted evidence; the
 * refresh resolves the shared sources once and iterates this list, so a new
 * family is one entry here, never another branch in the refresh.
 */
import { sql } from 'kysely';
import {
  detectBrandAbsentHighValuePrompt,
  detectOwnedPageNotCited,
  detectSiteIssueOpportunities,
} from '../analysis/opportunities/detectors.ts';
import type { DetectorHit } from '../analysis/opportunities/evidence.ts';
import {
  buildSourceProjection,
  emptySourceProjection,
} from '../analysis/opportunities/source-mix.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { earnedPageHits } from './earned-page-hits.ts';
import { internalLinkHits, internalLinkRunId } from './internal-link-hits.ts';
import { stampSourceMix, type SourceIdentity } from './refresh-compute.ts';
import {
  confirmedDeclineHits,
  loadSiteEvidence,
  loadVisibilityEvidence,
} from './refresh-evidence.ts';
import { changeHits, commerceHits, demandHits } from './refresh-hits.ts';
import { searchGapHits, searchGapSource, type SearchGapSource } from './search-gap-hits.ts';
import {
  currentDemandSnapshot,
  resolveAudit,
  resolveCommerceAuditId,
  resolveCrawl,
  type AuditSource,
  type CrawlSource,
  type DemandSource,
  type Scope,
} from './sources.ts';

const o = policy.opportunity.opportunities;

/** The sources one refresh reads, resolved once and shared by every family. */
export type Sources = {
  audit: AuditSource | null;
  commerceAuditId: string | null;
  crawl: CrawlSource | null;
  demand: DemandSource | null;
  gaps: SearchGapSource | null;
};
type Found = {
  hits: DetectorHit[];
  /** Evidence a load cap left out, carried onto the snapshot. */
  limitations: string[];
  /** The brand run's citation mix; only a usable brand run sets it. */
  sourceMix?: Record<string, unknown>;
};
type Family = {
  /** The source identity fields this family's hits are read from. */
  identity(db: Database, scope: Scope, sources: Sources): Promise<Partial<SourceIdentity>>;
  hits(db: Database, scope: Scope, sources: Sources, identity: SourceIdentity): Promise<Found>;
};

/**
 * The sources a refresh would read now, without loading their evidence. `at`
 * is the one instant a refresh judges dataset age by, so both resolutions agree.
 */
export async function resolveSources(db: Database, scope: Scope, at: Date): Promise<Sources> {
  return {
    audit: await resolveAudit(db, scope),
    commerceAuditId: await resolveCommerceAuditId(db, scope),
    crawl: await resolveCrawl(db, scope),
    demand: await currentDemandSnapshot(db, scope),
    gaps: await searchGapSource(db, scope, at),
  };
}

/**
 * The source-page state earned-page hits read: the newest inspected reading
 * (older readings are immutable) and the latest change to any page's state,
 * which a failed or blocked inspection moves without a new reading.
 */
async function sourcePagesRevision(db: Database, scope: Scope) {
  const { rows } = await sql<{ reading: string | null; pages: string | null }>`
    select
      (select id from source_page_snapshots
        where workspace_id = ${scope.workspaceId} and project_id = ${scope.projectId}
          and outcome = ${policy.opportunity.refresh.source_page_outcome_inspected}
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
};

/** The brand run: prompt gaps, cited pages to get listed on, and confirmed declines. */
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
    // A run without its metric snapshot is not usable yet.
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
    // Page-keyed, over the FULL eligible answer set rather than the gap prompts.
    hits.push(...(await earnedPageHits(db, scope, audit, evidence)));
    hits = hits.map((hit) => ({ ...hit, source_metric_ids: [metricId] }));
    hits.push(...(await confirmedDeclineHits(db, scope.workspaceId, audit.id)));
    return { hits, limitations, sourceMix };
  },
};

/** Commerce reads its own latest run, so brand and Commerce Actions never replace each other. */
const commerce: Family = {
  identity: async (_db, _scope, { commerceAuditId }) => ({ commerce_audit_id: commerceAuditId }),
  hits: async (db, scope, { commerceAuditId }) =>
    commerceAuditId === null
      ? none()
      : { hits: await commerceHits(db, scope, commerceAuditId), limitations: [] },
};

/** The crawl: Site Health findings, contextual links and page changes. */
const site: Family = {
  identity: async (db, scope, { crawl }) => ({
    site_crawl_id: crawl?.id ?? null,
    internal_link_run_id: crawl ? await internalLinkRunId(db, scope, crawl.id) : null,
  }),
  async hits(db, scope, { crawl }, identity) {
    if (crawl === null) return none();
    const evidence = await loadSiteEvidence(db, scope.workspaceId, crawl);
    return {
      hits: [
        ...detectSiteIssueOpportunities(evidence),
        ...(await internalLinkHits(db, scope, identity.internal_link_run_id)),
        ...(await changeHits(db, scope.workspaceId, crawl)),
      ],
      limitations: evidence.truncated
        ? [
            `Only the first ${o.RECOMPUTE_MAX_ISSUES} Site Health findings were ranked; later ones are not shown.`,
          ]
        : [],
    };
  },
};

const searchGaps: Family = {
  identity: async (_db, _scope, { gaps }) => ({ search_gap_revision: gaps?.revision ?? null }),
  hits: (db, scope, { gaps, demand: snapshot, crawl }) =>
    searchGapHits(db, scope, gaps, snapshot, crawl),
};

/** In hit order: the refresh concatenates each family's hits as listed. */
const FAMILIES: readonly Family[] = [demand, visibility, commerce, site, searchGaps];

const EMPTY_IDENTITY: SourceIdentity = {
  audit_id: null,
  commerce_audit_id: null,
  site_crawl_id: null,
  demand_snapshot_id: null,
  demand_source_revision: null,
  internal_link_run_id: null,
  source_pages_revision: null,
  search_gap_revision: null,
};

/** Every family's identity fields, read in order on the caller's connection. */
export async function sourceIdentity(
  db: Database,
  scope: Scope,
  sources: Sources,
): Promise<SourceIdentity> {
  const identity = { ...EMPTY_IDENTITY };
  for (const family of FAMILIES) Object.assign(identity, await family.identity(db, scope, sources)); // NOSONAR -- The connection may be a transaction.
  return identity;
}

/**
 * Every family's hits and limitations, the brand run's citation mix, and the
 * brand run itself when it was usable.
 */
export async function collectFamilies(
  db: Database,
  scope: Scope,
  sources: Sources,
  identity: SourceIdentity,
) {
  const hits: DetectorHit[] = [];
  const limitations: string[] = [];
  let sourceMix: Record<string, unknown> | null = null;
  for (const family of FAMILIES) {
    const found = await family.hits(db, scope, sources, identity); // NOSONAR -- One family at a time bounds the pool.
    hits.push(...found.hits);
    limitations.push(...found.limitations);
    if (found.sourceMix) sourceMix = found.sourceMix;
  }
  return {
    hits,
    limitations,
    sourceMix: sourceMix ?? emptySourceProjection(),
    audit: sourceMix === null ? null : sources.audit,
  };
}
