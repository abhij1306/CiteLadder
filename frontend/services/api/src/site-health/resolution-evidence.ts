/** Exact attempt and artifact provenance for terminal URL resolution checks. */
import type { Database } from '../db/database.ts';
import { policy } from '../config.ts';
import type { Crawl } from './task-fence.ts';
import { canonicalUrl } from './url-identity.ts';
import {
  canonicalIntegrity,
  entitySetEvaluation,
  finalizeEvaluation,
} from './analysis/finalize.ts';
import type { RuleEvaluation } from './analysis/rules.ts';
import { compareText } from '../text-order.ts';
import { onlyOf } from '../lists.ts';

export type Resolution = {
  status: number | null;
  finalUrl: string;
  redirected: boolean;
  /** Redirects followed to reach `finalUrl`; 0 for a URL that answered directly. */
  hops: number;
  /** The fetch error of the URL's last call, '' when it completed. */
  errorCode: string;
  taskId: string;
  attemptId: string;
  artifactId: string | null;
};
/** What the crawl observed about a canonical target page it analyzed. */
export type CanonicalTarget = { noindex: boolean; canonical: string | null };

const sourceIds = (row: Resolution) => [
  row.taskId,
  row.attemptId,
  ...(row.artifactId ? [row.artifactId] : []),
];
const limit = policy.site_health.page_analysis.facts.limits.evidence_urls;
const MAX_HOPS = policy.site_health.page_analysis.rules.redirect_max_hops;
/** A fetch that gave up following redirects: a loop or a chain past the hop cap. */
const REDIRECT_LIMIT = policy.site_health.page_analysis.acquisition.error_codes.redirect_limit;
/** Statuses that mean "sign in first", not "this link is broken". */
const ACCESS_RESTRICTED = new Set([401, 403]);
/**
 * Targets the crawler deliberately did not fetch (robots-denied, refused by
 * admission). They answered no HTTP request, so they are neither broken nor
 * redirecting. They leave the judged set (named as excluded_targets) instead
 * of staying unchecked: unchecked, one robots-denied footer link made every
 * page's link checks unknown.
 */
const EXCLUDED_ERRORS = new Set<string>(policy.site_health.reads.corpus_exclusion_error_codes);
const isExcludedTarget = (resolution: Resolution) =>
  resolution.status === null && EXCLUDED_ERRORS.has(resolution.errorCode);
/** Excluded targets stay named in the evidence, distinct from the ones that answered. */
const excludedTargets = (urls: string[], resolutions: Map<string, Resolution>) =>
  urls.slice(0, limit).map((url) => ({ url, reason: resolutions.get(url)!.errorCode }));

export async function fetchResolutions(db: Database, crawl: Crawl) {
  const rows = await db
    .selectFrom('site_crawl_tasks as t')
    .innerJoin('site_fetch_attempts as a', (join) =>
      join
        .onRef('a.task_id', '=', 't.id')
        .onRef('a.workspace_id', '=', 't.workspace_id')
        .onRef('a.crawl_id', '=', 't.crawl_id'),
    )
    .leftJoin('site_fetch_artifacts as f', (join) =>
      join
        .onRef('f.id', '=', 'a.artifact_id')
        .onRef('f.task_id', '=', 't.id')
        .onRef('f.workspace_id', '=', 't.workspace_id')
        .onRef('f.crawl_id', '=', 't.crawl_id'),
    )
    .select([
      't.requested_url',
      't.id as taskId',
      'a.status_code',
      'a.error_code',
      'a.id as attemptId',
      'f.final_url',
      'f.redirect_chain',
      'f.id as artifactId',
    ])
    .where('t.workspace_id', '=', crawl.workspace_id)
    .where('t.crawl_id', '=', crawl.id)
    .orderBy('a.created_at')
    .orderBy('a.attempt_number')
    .orderBy('a.request_ordinal')
    .orderBy('a.id')
    .execute();
  const resolutions = new Map<string, Resolution>();
  for (const row of rows) {
    const requested = canonicalUrl(row.requested_url);
    const final = canonicalUrl(row.final_url ?? '') ?? '';
    const hops = Array.isArray(row.redirect_chain) ? row.redirect_chain.length : 0;
    const value: Resolution = {
      status: row.status_code,
      finalUrl: final,
      redirected: hops > 0 || Boolean(final && final !== requested),
      hops,
      errorCode: row.error_code,
      taskId: row.taskId,
      attemptId: row.attemptId,
      artifactId: row.artifactId,
    };
    if (requested) resolutions.set(requested, value);
    if (final && row.status_code !== null)
      resolutions.set(final, { ...value, redirected: false, hops: 0 });
  }
  return resolutions;
}

/** A redirect the crawler followed, or one it abandoned as a loop or overlong chain. */
const redirects = (resolution: Resolution) =>
  resolution.redirected || resolution.errorCode === REDIRECT_LIMIT;

export function canonicalResolution(
  declarations: string[],
  finalUrl: string,
  resolutions: Map<string, Resolution>,
  targets: Map<string, CanonicalTarget> = new Map(),
) {
  // The same unique, trimmed set canonicalIntegrity judges: a repeated identical
  // declaration is one canonical, so its target still resolves.
  const unique = [...new Set(declarations.map((value) => value.trim()).filter(Boolean))];
  const only = onlyOf(unique);
  const target = only === undefined ? '' : (canonicalUrl(only, finalUrl) ?? '');
  const resolution = resolutions.get(target);
  const limited = resolution?.status === 429;
  // A self-canonical names this page: its own noindex is `technical.indexable`'s finding.
  const self = target === canonicalUrl(finalUrl);
  const evaluation = canonicalIntegrity({
    declarations,
    finalUrl,
    targetUrl: target,
    checked: Boolean(resolution) && !limited,
    statusCode: resolution?.status ?? null,
    redirected: resolution ? redirects(resolution) : false,
    target: self ? null : (targets.get(target) ?? null),
  });
  if (limited && evaluation.outcome === 'unknown') {
    evaluation.reason_code = 'rate_limited';
    evaluation.evidence = { ...evaluation.evidence, reason: 'rate_limited', status_code: 429 };
  }
  evaluation.evidence = {
    ...evaluation.evidence,
    canonical_url: target,
    final_url: resolution?.finalUrl ?? '',
    redirect_chain_present: resolution?.redirected ?? false,
    ...(resolution ? { observed_status_code: resolution.status } : {}),
    resolution_source_ids: resolution ? sourceIds(resolution) : [],
  };
  return evaluation;
}

/**
 * An HTTP error, except that a link to a sign-in-gated page works for the
 * people it is for; a sitemap that lists one still advertises a URL search
 * engines cannot read.
 */
const isBroken = (status: number, sitemap: boolean) =>
  status >= 400 && (sitemap || !ACCESS_RESTRICTED.has(status));

export function resolutionSet(
  targets: string[],
  resolutions: Map<string, Resolution>,
  sitemap = false,
): RuleEvaluation {
  const rule = sitemap ? 'technical.sitemap_url_unreachable' : 'technical.broken_internal_link';
  const checked: string[] = [];
  const limited: string[] = [];
  const broken: string[] = [];
  const excluded: string[] = [];
  for (const target of targets) {
    const resolution = resolutions.get(target);
    if (resolution?.status === 429) {
      limited.push(target);
      continue;
    }
    if (resolution && isExcludedTarget(resolution)) {
      excluded.push(target);
      continue;
    }
    if (resolution?.status === undefined || resolution.status === null) continue;
    checked.push(target);
    if (isBroken(resolution.status, sitemap)) broken.push(target);
  }
  // Excluded targets are outside the set this rule judges, not passes within it.
  const evaluation =
    sitemap && !targets.length
      ? finalizeEvaluation(rule, 'not_applicable', { reason: 'no_sitemap' })
      : entitySetEvaluation(rule, targets.length - excluded.length, checked.length, broken);
  if (limited.length && !broken.length) {
    evaluation.outcome = 'unknown';
    evaluation.reason_code = 'rate_limited_targets';
    evaluation.evidence.reason = 'rate_limited_targets';
  }
  evaluation.evidence = {
    ...evaluation.evidence,
    failing_targets: broken
      .slice(0, limit)
      .map((url) => ({ url, status_code: resolutions.get(url)!.status })),
    rate_limited_targets: limited.slice(0, limit).map((url) => ({ url, status_code: 429 })),
    excluded_targets: excludedTargets(excluded, resolutions),
    resolution_source_ids: [
      ...new Set([...checked, ...limited].flatMap((url) => sourceIds(resolutions.get(url)!))),
    ]
      .toSorted(compareText)
      .slice(0, limit),
  };
  if (!sitemap) {
    delete evaluation.evidence.normalized_score;
    delete evaluation.evidence.normalized_coverage;
  }
  return evaluation;
}

/** Where a redirecting URL ended up, for evidence a reader can act on. */
const redirectTarget = (url: string, resolution: Resolution) =>
  resolution.errorCode === REDIRECT_LIMIT
    ? { url, reason: 'redirect_limit' }
    : { url, final_url: resolution.finalUrl, hops: resolution.hops };

/** Internal link targets this crawl fetched that answered with a redirect. */
export function linkRedirects(targets: string[], resolutions: Map<string, Resolution>) {
  const checked: string[] = [];
  const failing: string[] = [];
  const excluded: string[] = [];
  for (const target of targets) {
    const resolution = resolutions.get(target);
    if (!resolution || resolution.status === 429) continue;
    if (isExcludedTarget(resolution)) {
      excluded.push(target);
      continue;
    }
    if (resolution.status === null && resolution.errorCode !== REDIRECT_LIMIT) continue;
    checked.push(target);
    if (redirects(resolution)) failing.push(target);
  }
  const evaluation = entitySetEvaluation(
    'technical.internal_link_redirect',
    targets.length - excluded.length,
    checked.length,
    failing,
  );
  delete evaluation.evidence.normalized_score;
  delete evaluation.evidence.normalized_coverage;
  evaluation.evidence = {
    ...evaluation.evidence,
    failing_targets: failing
      .slice(0, limit)
      .map((url) => redirectTarget(url, resolutions.get(url)!)),
    excluded_targets: excludedTargets(excluded, resolutions),
    resolution_source_ids: [...new Set(checked.flatMap((url) => sourceIds(resolutions.get(url)!)))]
      .toSorted(compareText)
      .slice(0, limit),
  };
  return evaluation;
}

/**
 * Every URL this crawl requested that redirected: more than the allowed hops,
 * or abandoned at the redirect limit, is a chain or loop to flatten.
 */
export function redirectChains(resolutions: Map<string, Resolution>) {
  const abandoned = (resolution: Resolution) => resolution.errorCode === REDIRECT_LIMIT;
  const redirected = [...resolutions].filter(
    ([, resolution]) => resolution.hops > 0 || abandoned(resolution),
  );
  const failing = redirected
    .filter(([, resolution]) => resolution.hops > MAX_HOPS || abandoned(resolution))
    .map(([url]) => url)
    .toSorted(compareText);
  return finalizeEvaluation('technical.redirect_chain', failing.length ? 'missing' : 'satisfied', {
    redirect_count: redirected.length,
    failure_count: failing.length,
    max_hops: MAX_HOPS,
    failing_targets: failing
      .slice(0, limit)
      .map((url) => redirectTarget(url, resolutions.get(url)!)),
    resolution_source_ids: [...new Set(failing.flatMap((url) => sourceIds(resolutions.get(url)!)))]
      .toSorted(compareText)
      .slice(0, limit),
  });
}
