import { pageKindSchema } from '@citeladder/contracts/site-health';
import type { PageKind, PageKindScoreSummary } from '@citeladder/contracts';
import { sentenceCaseStatus } from '@/lib/utils';

export const PAGE_KINDS: readonly PageKind[] = pageKindSchema.options;

const PAGE_KIND_LABELS: Record<PageKind, string> = {
  homepage: 'Homepage',
  article: 'Article',
  editorial_index: 'Editorial index',
  product: 'Product',
  category: 'Category',
  pricing: 'Pricing',
  docs: 'Docs',
  faq: 'FAQ',
  about_contact: 'About / Contact',
  service: 'Service',
  local: 'Local',
  guide: 'Guide',
  how_to: 'How-to',
  listicle: 'Listicle',
  comparison: 'Comparison',
  alternative: 'Alternative',
  case_study_review: 'Case Study / Review',
  trust_policy: 'Trust / Policy',
  other: 'Other',
};

export function pageKindLabel(pageKind: string): string {
  return isPageKind(pageKind) ? PAGE_KIND_LABELS[pageKind] : sentenceCaseStatus(pageKind);
}

function isPageKind(value: string): value is PageKind {
  return Object.hasOwn(PAGE_KIND_LABELS, value);
}

export type PageKindScoreRow = PageKindScoreSummary & { page_kind: string };

export function byPageKindRows(
  byPageKind: Record<string, PageKindScoreSummary>,
): PageKindScoreRow[] {
  const rank = new Map<string, number>(PAGE_KINDS.map((type, index) => [type, index]));
  return Object.entries(byPageKind)
    .map(([page_kind, scores]) => ({ page_kind, ...scores }))
    .sort((a, b) => {
      const aRank = rank.get(a.page_kind) ?? PAGE_KINDS.length;
      const bRank = rank.get(b.page_kind) ?? PAGE_KINDS.length;
      return aRank === bRank ? a.page_kind.localeCompare(b.page_kind) : aRank - bRank;
    });
}
