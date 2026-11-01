/**
 * Site-level architecture findings.
 *
 * Architecture findings are judged over the whole crawl and persisted ONCE,
 * against the homepage, with the pages (or page kinds) they found in the
 * evidence. Shown as an occurrence they read as "the homepage is buried too
 * deeply"; the pages in the evidence are the affected pages. Pure.
 */
import { records, sitePath, text, type Evidence } from './evidence-values';

const PAGE_LIST_RULES = new Set([
  'architecture.excessive_depth',
  'architecture.breadcrumb_hierarchy_conflict',
  'architecture.orphan_pages',
  'architecture.parentless_detail_pages',
]);
const PAGE_KIND_RULES = new Set([
  'architecture.duplicate_metadata_in_page_kind',
  'architecture.unhubbed_page_kind',
]);

/** The rules whose evidence lists affected pages. */
export const pageListRules: readonly string[] = [...PAGE_LIST_RULES];

type EvidencePage = Readonly<{
  siteUrlId: string;
  url: string;
  title: string | null;
  pageKind: string | null;
  /** Shortest click path from the homepage, only where depth is the finding. */
  clicksFromHome: number | null;
}>;

export type SiteLevelEvidence =
  | Readonly<{ kind: 'pages'; total: number; pages: readonly EvidencePage[] }>
  | Readonly<{
      kind: 'page_kinds';
      pageKinds: readonly Readonly<{ pageKind: string; pageCount: number | null }>[];
    }>;

function evidencePages(ruleId: string, evidence: Evidence): EvidencePage[] {
  const depthIsTheFinding = ruleId === 'architecture.excessive_depth';
  return records(evidence.pages).flatMap((page) => {
    const siteUrlId = text(page.site_url_id);
    const url = text(page.url);
    if (!siteUrlId || !url) return [];
    const depth = page.depth_from_home;
    return [
      {
        siteUrlId,
        url,
        title: text(page.title) || null,
        pageKind: text(page.page_kind) || null,
        clicksFromHome: depthIsTheFinding && typeof depth === 'number' ? depth : null,
      },
    ];
  });
}

/** The pages or page kinds a site-level finding names; `null` for a per-page rule. */
export function siteLevelEvidence(ruleId: string, evidence: Evidence): SiteLevelEvidence | null {
  if (PAGE_LIST_RULES.has(ruleId)) {
    const pages = evidencePages(ruleId, evidence);
    const count = evidence.count;
    return { kind: 'pages', total: typeof count === 'number' ? count : pages.length, pages };
  }
  if (PAGE_KIND_RULES.has(ruleId)) {
    const pageKinds = records(evidence.page_kinds).flatMap((row) => {
      const pageKind = text(row.page_kind);
      const count =
        ruleId === 'architecture.duplicate_metadata_in_page_kind'
          ? row.duplicate_metadata_count
          : row.page_count;
      return pageKind ? [{ pageKind, pageCount: typeof count === 'number' ? count : null }] : [];
    });
    return { kind: 'page_kinds', pageKinds };
  }
  return null;
}

/** A page-list finding's facts: each page's path, with its depth where depth is the finding. */
export function architecturePageFacts(ruleId: string) {
  return (evidence: Evidence): string[] =>
    evidencePages(ruleId, evidence).map((page) => {
      const path = sitePath(page.url, null);
      return page.clicksFromHome === null
        ? path
        : `${path} (${String(page.clicksFromHome)} clicks)`;
    });
}
