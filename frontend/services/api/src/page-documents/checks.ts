import { policy } from '../config.ts';
import { factSettings } from '../site-health/analysis/facts.ts';
import { analyzePageAsync, extractFactsAsync } from '../site-health/analysis/off-thread.ts';
import type { RuleEvaluation } from '../site-health/analysis/rules.ts';
import type { FetchedPage } from '../safe-fetch.ts';

const fetch = policy.content_optimization.page_fetch;
const SITE_CONTEXT: ReadonlySet<string> = new Set(fetch.site_context_rule_ids);

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
