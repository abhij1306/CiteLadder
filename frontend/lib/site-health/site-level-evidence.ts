/**
 * Site-level findings: architecture rules and sitewide links.
 *
 * Site-level findings are judged over the whole crawl and persisted ONCE,
 * against the homepage, with the pages (or page kinds, or link targets) they
 * found in the evidence (`siteLevelFindingSchema`). Shown as an occurrence
 * they read as "the homepage is buried too deeply"; the pages in the evidence
 * are the affected pages. Pure.
 */
import {
  siteLevelFinding,
  siteLevelRuleSchema,
  type SiteLevelFinding,
  type SiteLevelRule,
} from '@citeladder/contracts';
import { originOf, sitePath } from './evidence-values';

type PageListFinding = Extract<SiteLevelFinding, { evidence: { pages: unknown } }>;
type LinkTargetFinding = Extract<SiteLevelFinding, { evidence: { targets: unknown } }>;
type EvidenceTarget = LinkTargetFinding['evidence']['targets'][number];

/** The rules whose evidence lists affected pages. */
export const pageListRules: readonly SiteLevelRule[] = siteLevelRuleSchema.extract([
  'architecture.excessive_depth',
  'architecture.breadcrumb_hierarchy_conflict',
  'architecture.orphan_pages',
  'architecture.parentless_detail_pages',
  'architecture.unreachable_from_home',
]).options;
/** Every rule whose finding is persisted once for the site. */
export const siteLevelRules: readonly SiteLevelRule[] = siteLevelRuleSchema.options;

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
  | Readonly<{ kind: 'status'; statusCode: number | null }>
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
      pageKinds: readonly Readonly<{ pageKind: string; pageCount: number }>[];
    }>
  | Readonly<{
      kind: 'link_targets';
      /** Distinct pages carrying a failing link. */
      total: number;
      targets: readonly LinkTarget[];
    }>;

type SampledPage = Readonly<{
  site_url_id: string;
  url: string;
  title: string;
  page_kind: string;
  depth_from_home?: number | null;
}>;

function evidencePage(page: SampledPage, depthIsTheFinding: boolean): EvidencePage {
  return {
    siteUrlId: page.site_url_id,
    url: page.url,
    title: page.title || null,
    pageKind: page.page_kind || null,
    clicksFromHome: depthIsTheFinding ? (page.depth_from_home ?? null) : null,
  };
}

function evidencePages(finding: PageListFinding): EvidencePage[] {
  const depthIsTheFinding = finding.rule_id === 'architecture.excessive_depth';
  return finding.evidence.pages.map((page) => evidencePage(page, depthIsTheFinding));
}

function evidenceSections(finding: PageListFinding): EvidenceSection[] {
  return finding.rule_id === 'architecture.unreachable_from_home'
    ? finding.evidence.sections.map((row) => ({
        pathPrefix: row.path_prefix,
        pageCount: row.page_count,
      }))
    : [];
}

function linkOutcome(target: EvidenceTarget): LinkOutcome {
  if ('reason' in target) return { kind: 'loop' };
  if ('status_code' in target) return { kind: 'status', statusCode: target.status_code };
  return { kind: 'redirect', finalUrl: target.final_url, hops: target.hops };
}

function linkTargets(finding: LinkTargetFinding): LinkTarget[] {
  return finding.evidence.targets.map((target) => ({
    url: target.url,
    outcome: linkOutcome(target),
    pageCount: target.linking_page_count,
    pages: target.pages.map((page) => evidencePage(page, false)),
  }));
}

/** The pages, page kinds or link targets a site-level finding names; `null` for a per-page rule. */
export function siteLevelEvidence(ruleId: string, evidence: unknown): SiteLevelEvidence | null {
  const finding = siteLevelFinding(ruleId, evidence);
  if (finding === null) return null;
  switch (finding.rule_id) {
    case 'architecture.duplicate_metadata_in_page_kind':
    case 'architecture.unhubbed_page_kind': {
      const duplicates = finding.rule_id === 'architecture.duplicate_metadata_in_page_kind';
      return {
        kind: 'page_kinds',
        pageKinds: finding.evidence.page_kinds.map((row) => ({
          pageKind: row.page_kind,
          pageCount: duplicates ? row.duplicate_metadata_count : row.page_count,
        })),
      };
    }
    case 'technical.sitewide_broken_link':
    case 'technical.sitewide_link_redirect':
      return { kind: 'link_targets', total: finding.evidence.count, targets: linkTargets(finding) };
    default:
      return {
        kind: 'pages',
        total: finding.evidence.count,
        pages: evidencePages(finding),
        sections: evidenceSections(finding),
      };
  }
}

/** A page count in words: `1 page`, `158 pages`. */
export const pageCountLabel = (count: number) =>
  `${String(count)} ${count === 1 ? 'page' : 'pages'}`;

/** Where a sitewide link lands, as the reader would fix it: `404`, `/new`, `redirect loop`. */
export function linkOutcomeLabel(outcome: LinkOutcome, origin: string | null): string {
  switch (outcome.kind) {
    case 'status':
      return outcome.statusCode === null ? 'unreachable' : String(outcome.statusCode);
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
 * A site-level finding's facts, one per thing it names:
 *
 * - a page list: its sections when it groups pages by path
 *   (`/blogs/testimonials (158 pages)`), otherwise each page's path, with its
 *   depth where depth is the finding;
 * - page kinds: each affected kind;
 * - sitewide links: each link, where it lands, and on how many pages.
 *
 * Empty for a per-page rule.
 */
export function siteLevelFacts(ruleId: string, evidence: unknown): string[] {
  const listed = siteLevelEvidence(ruleId, evidence);
  switch (listed?.kind) {
    case undefined:
      return [];
    case 'page_kinds':
      return listed.pageKinds.map((row) => row.pageKind);
    case 'link_targets':
      return listed.targets.map((target) => {
        const origin = originOf(target.url);
        const landing = linkOutcomeLabel(target.outcome, origin);
        return `${sitePath(target.url, origin)} → ${landing} (on ${pageCountLabel(target.pageCount)})`;
      });
    case 'pages':
      if (listed.sections.length > 0)
        return listed.sections.map(
          (section) => `${section.pathPrefix} (${pageCountLabel(section.pageCount)})`,
        );
      return listed.pages.map((page) => {
        const path = sitePath(page.url, null);
        return page.clicksFromHome === null
          ? path
          : `${path} (${String(page.clicksFromHome)} clicks)`;
      });
    default: {
      const _exhaustive: never = listed;
      return _exhaustive;
    }
  }
}
