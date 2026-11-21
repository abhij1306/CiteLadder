import { lexicalTokens, termCoverage } from '../analysis/lexical.ts';
import { compareText } from '../text-order.ts';
import type { CandidatePage } from './load.ts';

export type TokenizedPage = { page: CandidatePage; tokens: ReadonlySet<string> };

export const tokenizePages = (pages: readonly CandidatePage[]): TokenizedPage[] =>
  pages.map((page) => ({
    page,
    tokens: lexicalTokens(`${page.title} ${page.headings.join(' ')} ${page.excerpt}`),
  }));

export function ownedCandidates(
  angleTerms: ReadonlySet<string>,
  contentPages: readonly TokenizedPage[],
  k: number,
): CandidatePage[] {
  return contentPages
    .map(({ page, tokens }) => ({ page, score: termCoverage(angleTerms, tokens) }))
    .filter((choice) => choice.score > 0)
    .sort((a, b) => b.score - a.score || compareText(a.page.siteUrlId, b.page.siteUrlId))
    .slice(0, k)
    .map((choice) => choice.page);
}
