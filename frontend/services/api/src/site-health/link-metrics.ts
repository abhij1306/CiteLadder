/** Append link metrics and admit architecture from the same persisted crawl. */
import { createHash, randomUUID } from 'node:crypto';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { policy, resolveSettingSpec } from '../config.ts';
import { buildLinkMetrics, type LinkPage } from './link-graph.ts';
import type { Crawl } from './task-fence.ts';

async function linkPages(db: Database, crawl: Crawl): Promise<LinkPage[]> {
  const observations = await db
    .selectFrom('site_url_observations')
    .select(['site_url_id', 'observed_url', 'final_url'])
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('crawl_id', '=', crawl.id)
    .execute();
  const aliases = new Map<string, Set<string>>();
  for (const row of observations) {
    const values = aliases.get(row.site_url_id) ?? new Set<string>();
    for (const url of [row.observed_url, row.final_url]) if (url) values.add(url);
    aliases.set(row.site_url_id, values);
  }
  const rows = await db
    .selectFrom('site_page_analyses as analysis')
    .innerJoin('site_urls as url', 'url.id', 'analysis.site_url_id')
    .innerJoin('site_fetch_artifacts as artifact', 'artifact.id', 'analysis.artifact_id')
    .select([
      'url.id',
      'url.normalized_url',
      'artifact.id as artifactId',
      'artifact.final_url',
      'artifact.normalized_facts',
    ])
    .where('analysis.workspace_id', '=', crawl.workspace_id)
    .where('analysis.project_id', '=', crawl.project_id)
    .where('analysis.crawl_id', '=', crawl.id)
    .where('analysis.status', '=', 'completed')
    .where('analysis.is_current', '=', true)
    .where('analysis.analyzer_version', '=', crawl.analyzer_version)
    .where('url.workspace_id', '=', crawl.workspace_id)
    .where('url.project_id', '=', crawl.project_id)
    .where('artifact.workspace_id', '=', crawl.workspace_id)
    .where('artifact.crawl_id', '=', crawl.id)
    .where('artifact.extractor_version', '=', crawl.extractor_version)
    .orderBy('url.id')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    url: row.normalized_url,
    finalUrl: row.final_url || row.normalized_url,
    artifactId: row.artifactId,
    facts: record(row.normalized_facts),
    aliases: [...(aliases.get(row.id) ?? [])],
  }));
}
async function enqueueArchitecture(db: Database, crawl: Crawl) {
  const versions = policy.site_health.versions;
  const version = [
    crawl.extractor_version || versions.extractor,
    crawl.analyzer_version || versions.analyzer,
    crawl.rule_catalog_version || versions.rules,
    versions.architecture,
    versions.archetype,
  ].join(':');
  const now = new Date();
  await db
    .insertInto('site_crawl_tasks')
    .values({
      id: randomUUID(),
      crawl_id: crawl.id,
      workspace_id: crawl.workspace_id,
      site_url_id: null,
      task_kind: 'architecture',
      requested_url: crawl.root_url,
      url_hash: createHash('sha256').update(`architecture:${crawl.id}:${version}`).digest('hex'),
      idempotency_key: `${crawl.id}:architecture:${version}`,
      status: 'queued',
      max_attempts: Number(resolveMaxAttempts()),
      available_at: now,
      created_at: now,
      updated_at: now,
      depth: 0,
      generation: 0,
      priority: 0,
      randomized_position: 0,
      attempt_count: 0,
      conflict_count: 0,
      classification_expected: false,
      error_code: '',
      error_detail: '',
    })
    .onConflict((conflict) => conflict.column('idempotency_key').doNothing())
    .execute();
}
// The queue default uses the Site Health admission policy.
function resolveMaxAttempts() {
  return resolveSettingSpec(policy.site_health.settings.max_attempts, process.env);
}
export async function persistLinkMetrics(db: Database, crawl: Crawl) {
  const metrics = buildLinkMetrics(await linkPages(db, crawl), crawl.root_url);
  const rows = metrics.map((metric) => ({
    ...metric,
    id: randomUUID(),
    workspace_id: crawl.workspace_id,
    project_id: crawl.project_id,
    crawl_id: crawl.id,
    extractor_version: crawl.extractor_version,
    formula_version: policy.site_health.link_metrics.formula_version,
    created_at: new Date(),
    anchor_diagnostics: JSON.stringify(metric.anchor_diagnostics),
    top_inbound: JSON.stringify(metric.top_inbound),
    top_outbound: JSON.stringify(metric.top_outbound),
  }));
  // Chunked only to stay under PostgreSQL's 65535 bind-parameter limit.
  const [first] = rows;
  const chunk = first ? Math.floor(65_535 / Object.keys(first).length) : 1;
  let inserted = 0;
  for (let start = 0; start < rows.length; start += chunk) {
    const written = await db
      .insertInto('site_page_link_metrics')
      .values(rows.slice(start, start + chunk))
      .onConflict((conflict) => conflict.constraint('uq_site_page_link_metric').doNothing())
      .returning('id')
      .execute();
    inserted += written.length;
  }
  await enqueueArchitecture(db, crawl);
  return inserted;
}
