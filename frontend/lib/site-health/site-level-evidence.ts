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

export const pageListRules: readonly SiteLevelRule[] = siteLevelRuleSchema.extract([
  'architecture.excessive_depth',
  'architecture.breadcrumb_hierarchy_conflict',
  'architecture.orphan_pages',
  'architecture.parentless_detail_pages',
  'architecture.unreachable_from_home',
  'architecture.dead_end_pages',
]).options;
export const siteLevelRules: readonly SiteLevelRule[] = siteLevelRuleSchema.options;

export const isSiteLevelRule = (ruleId: string) => siteLevelRuleSchema.safeParse(ruleId).success;

type EvidencePage = Readonly<{
  siteUrlId: string;
  url: string;
  title: string | null;
  pageKind: string | null;
  clicksFromHome: number | null;
}>;

type EvidenceSection = Readonly<{ pathPrefix: string; pageCount: number }>;

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

type DuplicateSet = Readonly<{
  text: string;
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
      kind: 'duplicate_sets';
      total: number;
      sets: readonly DuplicateSet[];
    }>
  | Readonly<{
      kind: 'link_targets';
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

const countedPages = (counts: Readonly<Record<string, number>>) =>
  Object.values(counts).reduce((sum, count) => sum + count, 0);

export function siteLevelEvidence(ruleId: string, evidence: unknown): SiteLevelEvidence | null {
  const finding = siteLevelFinding(ruleId, evidence);
  if (finding === null) return null;
  switch (finding.rule_id) {
    case 'architecture.duplicate_titles':
    case 'architecture.duplicate_meta_descriptions':
      return {
        kind: 'duplicate_sets',
        total: finding.evidence.count,
        sets: finding.evidence.duplicate_sets.map((set) => ({
          text: set.text,
          pageCount: set.page_count,
          pages: set.pages.map((page) => evidencePage(page, false)),
        })),
      };
    case 'architecture.unhubbed_page_kind':
      return {
        kind: 'pages',
        total: countedPages(finding.evidence.page_kind_counts),
        pages: finding.evidence.page_kinds.flatMap((row) =>
          row.pages.map((page) => evidencePage(page, false)),
        ),
        sections: [],
      };
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

export const pageCountLabel = (count: number) =>
  `${String(count)} ${count === 1 ? 'page' : 'pages'}`;

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

export function siteLevelFacts(ruleId: string, evidence: unknown): string[] {
  const listed = siteLevelEvidence(ruleId, evidence);
  switch (listed?.kind) {
    case undefined:
      return [];
    case 'duplicate_sets':
      return listed.sets.map((set) => `“${set.text}” (${pageCountLabel(set.pageCount)})`);
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
