/**
 * Site Health's page-local checks on the fetched page (content rules engine,
 * L0): the same extractor, classifier and evaluators a crawl runs, on this one
 * response. Rules that need the crawl (site, cluster and graph scopes, and the
 * sitemap checks) are left out; they keep the crawl's finding.
 */
import { policy } from '../config.ts';
import { factSettings } from '../site-health/analysis/facts.ts';
import { analyzePageAsync, extractFactsAsync } from '../site-health/analysis/off-thread.ts';
import type { RuleEvaluation } from '../site-health/analysis/rules.ts';
import type { FetchedPage } from '../safe-fetch.ts';

const fetch = policy.content_optimization.page_fetch;
const SITE_CONTEXT: ReadonlySet<string> = new Set(fetch.site_context_rule_ids);

/** One persisted check: the evaluation as Site Health judged it, without its catalog copy. */
export type PageCheck = Pick<
  RuleEvaluation,
  | 'rule_id'
  | 'rule_version'
  | 'dimension'
  | 'category'
  | 'severity'
  | 'finding_class'
  | 'outcome'
  | 'reason_code'
  | 'evidence'
  | 'display_applicability'
>;

const isPageLocal = (evaluation: RuleEvaluation) =>
  evaluation.scope === fetch.page_local_scope && !SITE_CONTEXT.has(evaluation.rule_id);

/** The page kind the fetched page reads as, and its page-local evaluations in catalog order. */
export async function pageLocalChecks(
  page: FetchedPage,
  fetched: { at: Date; latencyMs: number },
): Promise<{ pageKind: string; checks: PageCheck[] }> {
  const facts = await extractFactsAsync(
    page.body,
    {
      finalUrl: page.url,
      contentType: page.contentType,
      charset: page.charset,
      statusCode: page.status,
      headers: page.headers,
      httpVersion: page.httpVersion,
      ttfbMs: page.ttfbMs,
      latencyMs: fetched.latencyMs,
      wireBytes: page.wireBytes,
      decodedBytes: page.body.length,
    },
    factSettings(),
  );
  const result = await analyzePageAsync(facts, {
    // A single fetch has no sitemap or site-level evidence; the checks that read them are left out.
    sitemapMember: false,
    siteFacts: null,
    auditTime: fetched.at.toISOString(),
  });
  return {
    pageKind: result.assessment.page_kind,
    checks: result.evaluations.filter(isPageLocal).map((evaluation) => ({
      rule_id: evaluation.rule_id,
      rule_version: evaluation.rule_version,
      dimension: evaluation.dimension,
      category: evaluation.category,
      severity: evaluation.severity,
      finding_class: evaluation.finding_class,
      outcome: evaluation.outcome,
      reason_code: evaluation.reason_code,
      evidence: evaluation.evidence,
      display_applicability: evaluation.display_applicability,
    })),
  };
}
