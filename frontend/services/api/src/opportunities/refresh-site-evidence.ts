import { siteLevelFinding, type SiteLevelFinding } from '@citeladder/contracts/site-health';
import { sql } from 'kysely';

import { policy } from '../config.ts';
import type { SiteEvidence } from '../analysis/opportunities/evidence.ts';
import type { Database } from '../db/database.ts';
import { parseUuids } from '../http/uuid.ts';
import { viewIssuesSql, type ViewCrawl } from '../site-health/reads/crawl.ts';
import { siteLevelRule, siteLevelScope } from '../site-health/reads/rules.ts';
import { compareText } from '../text-order.ts';
import { siteCoverage, type CoverageCrawl } from './refresh-compute.ts';

const family = policy.opportunity.opportunities.SITE_ISSUE_FAMILY;
type Family = SiteEvidence['families'][number];
type Page = Family['pages'][number];

async function perPageFamilies(db: Database, crawl: ViewCrawl): Promise<Family[]> {
  const { rows } = await sql<{
    rule_id: string;
    severity: string;
    category: string;
    site_url_id: string;
    url: string;
    issue_ids: string[];
    page_count: number;
  }>`
    with pages as (
      select i.rule_id, i.site_url_id, u.normalized_url as url,
        min(coalesce(i.severity, '')) as severity, min(coalesce(i.category, '')) as category,
        array_agg(i.id::text order by i.id) as issue_ids
      from site_issues i
      join site_urls u on u.workspace_id = i.workspace_id and u.id = i.site_url_id
        and u.project_id = ${crawl.project_id}
      where ${viewIssuesSql(crawl)} and not ${siteLevelRule}
      group by i.rule_id, i.site_url_id, u.normalized_url
    ), ranked as (
      select pages.*,
        row_number() over (partition by rule_id order by url collate "C", site_url_id) as page_rank,
        count(*) over (partition by rule_id) as page_count
      from pages
    )
    select rule_id, severity, category, site_url_id, url, issue_ids,
      page_count::int as page_count
    from ranked
    where page_rank <= ${family.COHORT_PAGES_MAX}
    order by rule_id collate "C", page_rank`.execute(db);
  const families = new Map<string, Family>();
  for (const row of rows) {
    const key = row.rule_id;
    const page = { site_url_id: row.site_url_id, url: row.url };
    const found = families.get(key);
    if (found) {
      found.pages.push(page);
      found.issue_ids.push(...row.issue_ids);
    } else
      families.set(key, {
        rule_id: row.rule_id,
        severity: row.severity,
        category: row.category,
        page_count: row.page_count,
        whole_site: false,
        issue_ids: [...row.issue_ids],
        pages: [page],
      });
  }
  return [...families.values()];
}

export function evidencePages(finding: SiteLevelFinding): Page[] {
  switch (finding.rule_id) {
    case 'architecture.duplicate_titles':
    case 'architecture.duplicate_meta_descriptions':
      return finding.evidence.duplicate_sets.flatMap((set) => pick(set.pages));
    case 'architecture.unhubbed_page_kind':
      return finding.evidence.page_kinds.flatMap((kind) => pick(kind.pages));
    case 'technical.sitewide_broken_link':
    case 'technical.sitewide_link_redirect':
      return finding.evidence.targets.flatMap((target) => pick(target.pages));
    default:
      return pageListPages(finding);
  }
}

const pick = (pages: readonly Page[]) =>
  pages.map(({ site_url_id, url }) => ({ site_url_id, url }));

type PageListFinding = Extract<
  SiteLevelFinding,
  {
    rule_id:
      | 'architecture.excessive_depth'
      | 'architecture.breadcrumb_hierarchy_conflict'
      | 'architecture.orphan_pages'
      | 'architecture.parentless_detail_pages'
      | 'architecture.dead_end_pages'
      | 'architecture.unreachable_from_home';
  }
>;

function pageListPages(finding: PageListFinding): Page[] {
  switch (finding.rule_id) {
    case 'architecture.excessive_depth':
    case 'architecture.breadcrumb_hierarchy_conflict':
    case 'architecture.orphan_pages':
    case 'architecture.parentless_detail_pages':
    case 'architecture.dead_end_pages':
    case 'architecture.unreachable_from_home':
      return pick(finding.evidence.pages);
    default: {
      const unhandled: never = finding;
      return unhandled;
    }
  }
}

type SiteLevelRow = {
  id: string;
  rule_id: string;
  severity: string;
  category: string;
  site_url_id: string;
  url: string;
  evidence: unknown;
};

function siteLevelFamily(found: Family | undefined, row: SiteLevelRow, named: Page[]): Family {
  const earlier = found && !found.whole_site ? found.pages : [];
  const merged = new Map([...earlier, ...named].map((page) => [page.site_url_id, page] as const));
  const sorted = [...merged.values()].sort(
    (left, right) =>
      compareText(left.url, right.url) || compareText(left.site_url_id, right.site_url_id),
  );
  const wholeSite = sorted.length === 0;
  return {
    rule_id: row.rule_id,
    severity: row.severity,
    category: row.category,
    page_count: wholeSite
      ? 0
      : Math.max(sorted.length, siteLevelScope(row.rule_id, row.evidence)?.affected ?? 0),
    whole_site: wholeSite,
    issue_ids: [...(found?.issue_ids ?? []), row.id],
    pages: wholeSite
      ? [{ site_url_id: row.site_url_id, url: row.url }]
      : sorted.slice(0, family.COHORT_PAGES_MAX),
  };
}

async function siteLevelFamilies(db: Database, crawl: ViewCrawl): Promise<Family[]> {
  const { rows } = await sql<SiteLevelRow>`
    select i.id, i.rule_id, i.severity, i.category, i.site_url_id,
      u.normalized_url as url, i.evidence
    from site_issues i
    join site_urls u on u.workspace_id = i.workspace_id and u.id = i.site_url_id
      and u.project_id = ${crawl.project_id}
    where ${viewIssuesSql(crawl)} and ${siteLevelRule}
    order by i.rule_id collate "C", i.id`.execute(db);
  const named = rows.flatMap((row) => {
    const finding = siteLevelFinding(row.rule_id, row.evidence);
    return finding ? [{ row, pages: evidencePages(finding) }] : [];
  });
  const ids = parseUuids(named.flatMap(({ pages }) => pages.map((page) => page.site_url_id)));
  const owned = new Map(
    (ids.length
      ? await db
          .selectFrom('site_urls')
          .select(['id', 'normalized_url'])
          .where('workspace_id', '=', crawl.workspace_id)
          .where('project_id', '=', crawl.project_id)
          .where('id', 'in', ids)
          .execute()
      : []
    ).map((url) => [url.id, url.normalized_url]),
  );
  const families = new Map<string, Family>();
  for (const { row, pages } of named) {
    const key = row.rule_id;
    const owns = pages.flatMap(({ site_url_id }) => {
      const url = owned.get(site_url_id);
      return url === undefined ? [] : [{ site_url_id, url }];
    });
    families.set(key, siteLevelFamily(families.get(key), row, owns));
  }
  return [...families.values()];
}

export async function loadSiteEvidence(
  db: Database,
  crawl: CoverageCrawl & ViewCrawl,
): Promise<SiteEvidence> {
  const [coverage, limitations] = siteCoverage(crawl);
  return {
    crawl_id: crawl.id,
    families: [...(await perPageFamilies(db, crawl)), ...(await siteLevelFamilies(db, crawl))],
    coverage,
    limitations,
  };
}
