/**
 * Site-level findings: architecture rules and sitewide links.
 *
 * Site-level findings are judged over the whole crawl and persisted ONCE,
 * against the homepage, with the pages (or page kinds, or link targets) they
 * found in the evidence. Shown as an occurrence they read as "the homepage is
 * buried too deeply"; the pages in the evidence are the affected pages. Pure.
 */
import { originOf, records, sitePath, text, type Evidence } from './evidence-values';

const PAGE_LIST_RULES = new Set([
  'architecture.excessive_depth',
  'architecture.breadcrumb_hierarchy_conflict',
  'architecture.orphan_pages',
  'architecture.parentless_detail_pages',
  'architecture.unreachable_from_home',
]);
const PAGE_KIND_RULES = new Set([
  'architecture.duplicate_metadata_in_page_kind',
  'architecture.unhubbed_page_kind',
]);
const LINK_TARGET_RULES = new Set([
  'technical.sitewide_broken_link',
  'technical.sitewide_link_redirect',
]);

/** The rules whose evidence lists affected pages. */
export const pageListRules: readonly string[] = [...PAGE_LIST_RULES];
/** The rules whose evidence lists sitewide link targets and the pages carrying them. */
export const linkTargetRules: readonly string[] = [...LINK_TARGET_RULES];

type EvidencePage = Readonly<{
  siteUrlId: string;
  url: string;
  title: string | null;
  pageKind: string | null;
  /** Shortest click path from the homepage, only where depth is the finding. */
  clicksFromHome: number | null;
}>;

/** A group of affected pages under one path prefix, largest first. */
type EvidenceSection = Readonly<{ pathPrefix: string; pageCount: number }>;

/** Where a sitewide link goes wrong, spelled as the link's outcome. */
type LinkOutcome =
  | Readonly<{ kind: 'status'; statusCode: number }>
  | Readonly<{ kind: 'redirect'; finalUrl: string; hops: number }>
  | Readonly<{ kind: 'loop' }>;

type LinkTarget = Readonly<{
  url: string;
  outcome: LinkOutcome;
  pageCount: number;
  pages: readonly EvidencePage[];
}>;

export type SiteLevelEvidence =
  | Readonly<{
      kind: 'pages';
      total: number;
      pages: readonly EvidencePage[];
      sections: readonly EvidenceSection[];
    }>
  | Readonly<{
      kind: 'page_kinds';
      pageKinds: readonly Readonly<{ pageKind: string; pageCount: number | null }>[];
    }>
  | Readonly<{
      kind: 'link_targets';
      /** Distinct pages carrying a failing link; `null` when the evidence did not record it. */
      total: number | null;
      targets: readonly LinkTarget[];
    }>;

function pagesOf(value: unknown, depthIsTheFinding: boolean): EvidencePage[] {
  return records(value).flatMap((page) => {
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

const evidencePages = (ruleId: string, evidence: Evidence) =>
  pagesOf(evidence.pages, ruleId === 'architecture.excessive_depth');

function evidenceSections(evidence: Evidence): EvidenceSection[] {
  return records(evidence.sections).flatMap((row) => {
    const pathPrefix = text(row.path_prefix);
    const pageCount = row.page_count;
    return pathPrefix && typeof pageCount === 'number' ? [{ pathPrefix, pageCount }] : [];
  });
}

function linkOutcome(target: Evidence): LinkOutcome | null {
  if (target.reason === 'redirect_limit') return { kind: 'loop' };
  if (typeof target.status_code === 'number')
    return { kind: 'status', statusCode: target.status_code };
  const finalUrl = text(target.final_url);
  if (!finalUrl) return null;
  return { kind: 'redirect', finalUrl, hops: typeof target.hops === 'number' ? target.hops : 1 };
}

function linkTargets(evidence: Evidence): LinkTarget[] {
  return records(evidence.targets).flatMap((target) => {
    const url = text(target.url);
    const outcome = linkOutcome(target);
    if (!url || !outcome) return [];
    const pages = pagesOf(target.pages, false);
    const count = target.linking_page_count;
    return [{ url, outcome, pageCount: typeof count === 'number' ? count : pages.length, pages }];
  });
}

/** The pages, page kinds or link targets a site-level finding names; `null` for a per-page rule. */
export function siteLevelEvidence(ruleId: string, evidence: Evidence): SiteLevelEvidence | null {
  if (PAGE_LIST_RULES.has(ruleId)) {
    const pages = evidencePages(ruleId, evidence);
    const count = evidence.count;
    return {
      kind: 'pages',
      total: typeof count === 'number' ? count : pages.length,
      pages,
      sections: evidenceSections(evidence),
    };
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
  if (LINK_TARGET_RULES.has(ruleId)) {
    const targets = linkTargets(evidence);
    const count = evidence.count;
    return { kind: 'link_targets', total: typeof count === 'number' ? count : null, targets };
  }
  return null;
}

/** A page count in words: `1 page`, `158 pages`. */
export const pageCountLabel = (count: number) =>
  `${String(count)} ${count === 1 ? 'page' : 'pages'}`;

/** Where a sitewide link lands, as the reader would fix it: `404`, `/new`, `redirect loop`. */
export function linkOutcomeLabel(outcome: LinkOutcome, origin: string | null): string {
  switch (outcome.kind) {
    case 'status':
      return String(outcome.statusCode);
    case 'loop':
      return 'redirect loop';
    case 'redirect': {
      const hops = outcome.hops > 1 ? ` (${String(outcome.hops)} hops)` : '';
      return `${sitePath(outcome.finalUrl, origin)}${hops}`;
    }
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

/**
 * A page-list finding's facts: its sections when it groups pages by path
 * (`/blogs/testimonials (158 pages)`), otherwise each page's path, with its
 * depth where depth is the finding.
 */
export function architecturePageFacts(ruleId: string) {
  return (evidence: Evidence): string[] => {
    const grouped = evidenceSections(evidence);
    if (grouped.length > 0)
      return grouped.map(
        (section) => `${section.pathPrefix} (${pageCountLabel(section.pageCount)})`,
      );
    return evidencePages(ruleId, evidence).map((page) => {
      const path = sitePath(page.url, null);
      return page.clicksFromHome === null
        ? path
        : `${path} (${String(page.clicksFromHome)} clicks)`;
    });
  };
}

/** A sitewide link finding's facts: each link, where it lands, and on how many pages. */
export function linkTargetFacts(evidence: Evidence): string[] {
  return linkTargets(evidence).map((target) => {
    const origin = originOf(target.url);
    const landing = linkOutcomeLabel(target.outcome, origin);
    return `${sitePath(target.url, origin)} → ${landing} (on ${pageCountLabel(target.pageCount)})`;
  });
}
