/** Bounded request normalization and persisted-only URL previews. */
import { randomBytes } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { getDomain } from 'tldts';
import { z } from 'zod';
import { asApiErrorCode } from '@citeladder/contracts/error-codes';
import { policy, resolveSettingSpec } from '../config.ts';
import { ApiError, notFound } from '../errors.ts';
import type { Database } from '../db/database.ts';
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
const optionalList = z.array(z.string()).nullable().optional();
export const createCrawlRequest = z.strictObject({
  project_id: z.uuid(),
  include_globs: optionalList,
  exclude_globs: optionalList,
  seed: z.string().nullable().optional(),
  input_mode: z.enum(['auto', 'exact_urls', 'discovery_seeds']).nullable().optional(),
  requested_page_limit: z.int().min(1).nullable().optional(),
  discovery_count: z.int().min(1).nullable().optional(),
  seed_urls: optionalList,
  page_kinds: optionalList,
});
export const previewRequest = z.strictObject({
  project_id: z.uuid(),
  content: z.union([z.string(), z.array(z.string()), z.record(z.string(), z.unknown())]),
  input_format: z.enum(['text', 'csv', 'json']).default('text'),
  include_globs: optionalList,
  exclude_globs: optionalList,
});
export type CreateCrawlRequest = z.infer<typeof createCrawlRequest>;

export function normalizeGlobs(values: string[] | null | undefined) {
  const result = (values ?? []).map((value) => value.trim()).filter(Boolean);
  if (
    result.length > Number(crawlSetting('max_narrowing_globs')) ||
    result.some((value) => value.length > Number(crawlSetting('max_glob_length')))
  )
    crawlError('Crawl narrowing globs exceed the allowed bounds');
  return result;
}
export function normalizedSeed(seed: string | null | undefined) {
  if (!seed?.trim()) return randomBytes(8).readBigUInt64BE().toString();
  if (!/^[+-]?\d+$/u.test(seed.trim())) crawlError('random_seed must be an integer');
  return BigInt.asUintN(64, BigInt(seed.trim())).toString();
}
export function controls(request: CreateCrawlRequest, developmentAccess = false) {
  const mode = request.input_mode ?? 'auto';
  const seeds = request.seed_urls ?? [];
  const kinds = request.page_kinds ?? [];
  const advanced = developmentAccess || crawlSetting('advanced_controls_enabled') === true;
  if (seeds.length > Number(crawlSetting('max_seed_urls'))) crawlError('too many seed_urls');
  if (
    kinds.some((kind) => !policy.site_health.page_analysis.classification.page_kinds.includes(kind))
  )
    crawlError('unknown page kind');
  if (!advanced && (mode !== 'auto' || seeds.length || kinds.length))
    crawlError('advanced crawl controls are unavailable', 'advanced_controls_unavailable');
  if (mode === 'exact_urls' && !seeds.length) crawlError('exact_urls requires seed_urls');
  const limit =
    request.discovery_count ??
    request.requested_page_limit ??
    Number(crawlSetting('automatic_page_limit'));
  const maximum = Number(
    crawlSetting(advanced ? 'max_advanced_requested_page_limit' : 'max_requested_page_limit'),
  );
  if (limit <= 0 || limit > maximum)
    crawlError('requested_page_limit is outside the allowed range', 'discovery_limit_exceeded');
  return { mode, seeds, kinds, limit };
}
async function projectRoot(db: Database, workspaceId: string, projectId: string, lock = false) {
  const query = db
    .selectFrom('projects')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', projectId);
  const project = await (lock ? query.forUpdate() : query).executeTakeFirst();
  if (!project) throw notFound('Project');
  return { project, ...projectWebsiteRoot(project.website_url) };
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
  selected: { mode: string; limit: number; seeds: string[]; kinds: string[] },
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
    include_globs: scope.include,
    exclude_globs: scope.exclude,
    url_admission_policy_version: policy.site_health.crawl.admission_policy_version,
    page_kind_classifier_version: policy.site_health.page_analysis.classification.version,
    page_profile_rule_version: policy.site_health.versions.rules,
    input_mode: selected.mode,
    requested_page_limit: selected.limit,
    seed_urls: selected.seeds,
    page_kinds: selected.kinds,
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
  if (selected.mode === 'auto')
    configuration[policy.site_health.crawl.automatic_monitor_limit_key] = Math.min(
      selected.limit,
      sample ? runtime.sample_url_limit : runtime.monitored_url_limit,
    );
  return configuration;
}

function previewChunkBytes(value: unknown, pending: unknown[]) {
  if (Array.isArray(value)) {
    for (const item of value) pending.push(item);
    return 2 + Math.max(0, value.length - 1);
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    let bytes = 2 + Math.max(0, entries.length - 1);
    for (const [key, item] of entries) {
      bytes += Buffer.byteLength(JSON.stringify(key)) + 1;
      pending.push(item);
    }
    return bytes;
  }
  return Buffer.byteLength(JSON.stringify(value) ?? 'null');
}

/** Count bounded JSON chunks without constructing one potentially huge encoding. */
function ensurePreviewSize(content: unknown) {
  const maximum = Number(crawlSetting('max_preview_input_bytes'));
  if (typeof content === 'string') {
    if (Buffer.byteLength(content) > maximum) crawlError('preview input is too large');
    return;
  }
  const pending = [content];
  let bytes = 0;
  while (pending.length) {
    bytes += previewChunkBytes(pending.pop(), pending);
    if (bytes > maximum) crawlError('preview input is too large');
  }
}

function previewRows(content: unknown, format: string): string[] {
  ensurePreviewSize(content);
  if (Array.isArray(content)) return content.map(String);
  if (content && typeof content === 'object') {
    const object = content as Record<string, unknown>;
    const values = object.urls ?? object.items ?? [];
    if (!Array.isArray(values)) crawlError('JSON preview input must contain a URL list');
    return values.map((value) =>
      value && typeof value === 'object' ? String(value.url ?? '') : String(value),
    );
  }
  if (typeof content !== 'string') crawlError('preview input must be text or a URL list');
  const raw = content;
  if (format === 'json') {
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      crawlError('invalid JSON preview input');
    }
    if (!decoded || typeof decoded !== 'object')
      crawlError('JSON preview input must contain a URL list');
    return previewRows(decoded, 'text');
  }
  if (format === 'csv') {
    try {
      return (parse(raw, { relax_column_count: true, skip_empty_lines: false }) as string[][]).map(
        (row) => row[0] ?? '',
      );
    } catch {
      crawlError('invalid CSV preview input');
    }
  }
  return raw
    .split(/\r\n|[\n\r\v\f\u0085\u2028\u2029]/u)
    .filter((_, index, rows) => index !== rows.length - 1 || rows[index] !== '');
}
export async function previewCrawlUrls(
  db: Database,
  workspaceId: string,
  request: z.infer<typeof previewRequest>,
) {
  const { domain } = await projectRoot(db, workspaceId, request.project_id);
  const scope: Scope = {
    domain,
    include: normalizeGlobs(request.include_globs),
    exclude: normalizeGlobs(request.exclude_globs),
  };
  const seen = new Set<string>();
  const counts = { accepted: 0, duplicate: 0, rejected: 0 };
  const maximum = Number(crawlSetting('max_preview_rows'));
  const parsed = previewRows(request.content, request.input_format);
  const rows = parsed.slice(0, maximum);
  const items = rows.map((raw, index) => {
    const decision = classifyUrlAdmission(raw, scope);
    const duplicate = decision.accepted && decision.url !== null && seen.has(decision.url);
    if (duplicate) counts.duplicate++;
    else if (decision.accepted) {
      counts.accepted++;
      seen.add(decision.url!);
    } else counts.rejected++;
    return {
      row: index + 1,
      input: raw.slice(0, Number(crawlSetting('max_glob_length'))),
      accepted: decision.accepted && !duplicate,
      canonical_url: decision.url,
      reason_code: duplicate ? policy.site_health.crawl.exclusions.duplicate : decision.reason,
      value_kind: decision.valueKind,
      priority: decision.priority,
    };
  });
  return {
    items,
    truncated: parsed.length > maximum,
    counts,
    policy_version: policy.site_health.crawl.admission_policy_version,
  };
}
