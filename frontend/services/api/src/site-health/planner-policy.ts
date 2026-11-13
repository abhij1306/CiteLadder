/** Bounded crawl request normalization and the policy frozen on each crawl. */
import { getDomain } from 'tldts';
import { z } from 'zod';
import { asApiErrorCode } from '@citeladder/contracts/error-codes';
import type { CrawlRobotsHandling } from '@citeladder/contracts/site-health';
import { siteCrawlCreateRequestSchema } from '@citeladder/contracts/site-health-requests';
import { policy } from '../config.ts';
import { resolveSettingSpec } from '../config/settings.ts';
import { ApiError } from '../errors.ts';
import type { Selectable } from 'kysely';
import type { WorkspaceSiteHealthRuntime } from '../generated/db-schema.ts';
import { classifyUrlAdmission, type Scope } from './url-admission.ts';

export const crawlSetting = (key: keyof typeof policy.site_health.settings) =>
  resolveSettingSpec(policy.site_health.settings[key], process.env);
export function crawlError(
  message: string,
  code = 'invalid_crawl_request',
  status: 403 | 404 | 409 | 422 = 422,
  details?: Record<string, unknown>,
): never {
  throw new ApiError(status, message, {
    code: asApiErrorCode(code),
    details,
  });
}
export const createCrawlRequest = siteCrawlCreateRequestSchema;
type CreateCrawlRequest = z.infer<typeof createCrawlRequest>;

/** Who confirmed being authorized to crawl the site while ignoring robots.txt, and when. */
export const robotsDecisionSchema = z.object({
  user_id: z.uuid(),
  email: z.string(),
  decided_at: z.iso.datetime(),
});
export type RobotsDecision = z.infer<typeof robotsDecisionSchema>;

/**
 * A crawl to admit: the request plus the robots decision behind an `ignore`.
 * The decision comes from the signed-in person on Start crawl, or is kept from
 * the shown crawl (`crawlRequest`); never from the request body.
 */
export type CrawlAdmission = CreateCrawlRequest & { robots_decision?: RobotsDecision | null };

/** The crawl's robots handling; the page limit is the configured automatic one (SH-B13). */
export function controls(request: CrawlAdmission) {
  const robots = request.robots ?? 'respect';
  // Ignoring robots.txt is recorded against the person who confirmed authorization.
  const decision = robots === 'ignore' ? (request.robots_decision ?? null) : null;
  if (robots === 'ignore' && !decision)
    crawlError('ignoring robots.txt needs a confirmed, signed-in person');
  return {
    limit: Number(crawlSetting('automatic_page_limit')),
    robots,
    robotsDecision: decision,
  };
}

export function projectWebsiteRoot(websiteUrl: string | null) {
  const root = classifyUrlAdmission(websiteUrl ?? '');
  // A private suffix (`a.github.io`) is its own site, not every tenant of `github.io`.
  const domain = root.url
    ? getDomain(new URL(root.url).hostname, { allowPrivateDomains: true })
    : null;
  if (!root.accepted || !root.url || !domain)
    crawlError('Project has no admissible website URL', 'invalid_root');
  return { root: root.url, domain };
}

/** The operational policy frozen once per crawl. */
export function frozenConfiguration(
  scope: Scope,
  runtime: Selectable<WorkspaceSiteHealthRuntime>,
  selected: {
    limit: number;
    robots: CrawlRobotsHandling;
    robotsDecision: RobotsDecision | null;
  },
) {
  const sample = runtime.discovery_mode === 'sample';
  const configuration: Record<string, unknown> = {
    discovery_mode: runtime.discovery_mode,
    sample_mode: sample,
    count_disclosure: runtime.count_disclosure,
    sample_url_limit: runtime.sample_url_limit,
    monitored_url_limit: runtime.monitored_url_limit,
    discovery_url_cap: runtime.discovery_url_cap,
    root_registrable_domain: scope.domain,
    url_admission_policy_version: policy.site_health.crawl.admission_policy_version,
    page_kind_classifier_version: policy.site_health.page_analysis.classification.version,
    page_profile_rule_version: policy.site_health.versions.rules,
    requested_page_limit: selected.limit,
    // Read per fetch by the site crawl's discover and analyze tasks.
    robots: selected.robots,
    robots_decision: selected.robotsDecision,
    extractor_version: policy.site_health.versions.extractor,
    analyzer_version: policy.site_health.versions.analyzer,
    rule_catalog_version: policy.site_health.versions.rules,
    scoring_version: policy.site_health.reads.scoring_version,
  };
  const frozen = [
    'max_discovery_urls',
    'max_analysis_urls',
    'max_frontier_urls',
    'max_crawl_depth',
    'admission_batch_size',
    'global_concurrency',
    'per_host_concurrency',
    'per_host_delay_seconds',
    'request_timeout_seconds',
    'max_redirects',
    'max_response_wire_bytes',
    'max_response_decoded_bytes',
    'max_attempts',
  ] as const;
  for (const key of frozen) configuration[key] = crawlSetting(key);
  configuration[policy.site_health.crawl.automatic_monitor_limit_key] = Math.min(
    selected.limit,
    sample ? runtime.sample_url_limit : runtime.monitored_url_limit,
  );
  return configuration;
}
