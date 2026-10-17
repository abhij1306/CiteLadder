import { randomUUID } from 'node:crypto';
import type { Insertable, RawBuilder } from 'kysely';
import type { Database } from '../src/db/database.ts';
import type { SiteCrawls } from '../src/generated/db-schema.ts';
import { policy } from '../src/config.ts';
import {
  FetchError,
  type FetchedPage,
  type FetchOptions,
  type WebsiteFetcher,
} from '../src/projects/safe-fetch.ts';
import { canonicalIdentity } from '../src/site-health/url-identity.ts';
import { SiteHealthWorker } from '../src/workers/site-health-worker.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

type SiteWorkerOptions = NonNullable<ConstructorParameters<typeof SiteHealthWorker>[1]>;
export type SiteSeed = Tenant & { crawlId: string; profileId: string; root: string };
export class SiteFixtures extends VisibilityFixtures {
  readonly siteDb: Database;
  constructor(db: Database) {
    super(db);
    this.siteDb = db;
  }
  async crawl(status = 'completed'): Promise<SiteSeed> {
    const tenant = await this.tenant({ websiteUrl: 'https://example.test/' });
    const root = 'https://example.test/';
    const profileId = randomUUID();
    const now = new Date();
    await this.siteDb
      .insertInto('site_health_profiles')
      .values({
        id: profileId,
        workspace_id: tenant.workspaceId,
        project_id: tenant.projectId,
        root_host: 'example.test',
        root_url: root,
        registrable_domain: 'example.test',
        selection_version: 1,
        created_at: now,
        updated_at: now,
      })
      .execute();
    const seed = { ...tenant, root, profileId, crawlId: '' };
    return { ...seed, crawlId: await this.sibling(seed, { status }) };
  }
  /** Another crawl of the seed's project; `values` override the completed defaults. */
  async sibling(seed: SiteSeed, values: Partial<Insertable<SiteCrawls>> = {}) {
    const crawlId = randomUUID();
    const now = new Date();
    const versions = policy.site_health.versions;
    await this.siteDb
      .insertInto('site_crawls')
      .values({
        id: crawlId,
        workspace_id: seed.workspaceId,
        project_id: seed.projectId,
        profile_id: seed.profileId,
        root_url: seed.root,
        random_seed: 'fixture',
        status: 'completed',
        discovery_status: 'completed',
        analysis_status: 'completed',
        sample_mode: false,
        inventory_complete: true,
        admitted_url_count: 0,
        analyzed_url_count: 0,
        discovered_url_count: 0,
        failed_url_count: 0,
        discovery_requested_count: 0,
        analysis_requested_count: 0,
        partial_reason: '',
        error_message: '',
        extractor_version: versions.extractor,
        analyzer_version: versions.analyzer,
        rule_catalog_version: versions.rules,
        scoring_version: 'fixture',
        created_at: now,
        updated_at: now,
        completed_at: now,
        ...values,
      })
      .execute();
    return crawlId;
  }
  async task(
    seed: SiteSeed,
    kind = 'link_metrics',
    options: { priority?: number; maximum?: number } = {},
  ) {
    const now = new Date();
    const id = randomUUID();
    await this.siteDb
      .insertInto('site_crawl_tasks')
      .values({
        id,
        workspace_id: seed.workspaceId,
        crawl_id: seed.crawlId,
        task_kind: kind,
        requested_url: seed.root,
        url_hash: id.replaceAll('-', '').padEnd(64, '0'),
        idempotency_key: id,
        depth: 0,
        generation: 0,
        status: 'queued',
        priority: options.priority ?? 0,
        randomized_position: 0,
        attempt_count: 0,
        conflict_count: 0,
        max_attempts: options.maximum ?? 3,
        available_at: now,
        created_at: now,
        updated_at: now,
        error_code: '',
        error_detail: '',
        classification_expected: false,
      })
      .execute();
    return id;
  }
  /**
   * A fetch of `from` as the crawler persists it: one attempt row per call,
   * a 301 answered by `to` (whose final call links the artifact), or, with no
   * `to`, a fetch abandoned at the redirect limit.
   */
  async redirect(seed: SiteSeed, from: string, to?: string) {
    const requested = canonicalIdentity(from, seed.root).url;
    const final = to ? canonicalIdentity(to, seed.root).url : null;
    const taskId = await this.task(seed, 'discover');
    await this.siteDb
      .updateTable('site_crawl_tasks')
      .set({ requested_url: requested, status: final ? 'succeeded' : 'failed' })
      .where('id', '=', taskId)
      .execute();
    const now = new Date();
    const artifactId = final ? randomUUID() : null;
    if (artifactId)
      await this.siteDb
        .insertInto('site_fetch_artifacts')
        .values({
          id: artifactId,
          workspace_id: seed.workspaceId,
          crawl_id: seed.crawlId,
          task_id: taskId,
          requested_url: requested,
          final_url: final!,
          redirect_chain: JSON.stringify([
            { from_url: requested, to_url: final, status_code: 301 },
          ]),
          status_code: 200,
          content_type: 'text/html',
          content_hash: randomUUID().replaceAll('-', ''),
          normalized_facts: JSON.stringify({}),
          extractor_version: policy.site_health.versions.extractor,
          fetched_at: now,
          created_at: now,
          fetch_purpose: 'discover',
          acquisition_policy_version: 'fixture',
          acquisition_transport: 'recorded',
          acquisition_trigger: 'fixture',
          http_version: 'HTTP/1.1',
          impersonation_profile: '',
        })
        .execute();
    const call = (ordinal: number, status: number, errorCode: string, artifact: string | null) => ({
      id: randomUUID(),
      task_id: taskId,
      crawl_id: seed.crawlId,
      workspace_id: seed.workspaceId,
      attempt_number: 1,
      request_ordinal: ordinal,
      method: 'GET',
      target_host: 'example.test',
      outcome: errorCode ? 'error' : 'success',
      error_code: errorCode,
      status_code: status,
      latency_ms: 10,
      wire_bytes: null,
      decoded_bytes: null,
      acquisition_transport: 'recorded',
      acquisition_rung: null,
      acquisition_trigger: 'fixture',
      impersonation_profile: '',
      acquisition_options: null,
      acquisition_policy_version: 'fixture',
      artifact_id: artifact,
      created_at: now,
    });
    await this.siteDb
      .insertInto('site_fetch_attempts')
      .values(
        final
          ? [call(0, 301, '', null), call(1, 200, '', artifactId)]
          : [call(0, 301, '', null), call(1, 301, 'redirect_limit', null)],
      )
      .execute();
  }
  /**
   * A worker held to the seed's crawl. The local database is shared with other
   * test runs, so an unscoped worker could claim and run their tasks.
   */
  worker(seed: SiteSeed, options: Omit<SiteWorkerOptions, 'taskScope'> = {}) {
    return new SiteHealthWorker(this.siteDb, {
      ...options,
      taskScope: { workspaceId: seed.workspaceId, crawlId: seed.crawlId },
    });
  }
  /** Claims exactly task `id` for `worker`, without executing it. */
  async claim(worker: SiteHealthWorker, seed: SiteSeed, kind: string, id: string) {
    const [task] = await worker.queue.claim({
      owner: worker.owner,
      kinds: [kind],
      scope: { workspaceId: seed.workspaceId, taskIds: [id] },
    });
    return task!;
  }
  async page(
    seed: SiteSeed,
    path: string,
    facts: Record<string, unknown>,
    options: {
      current?: boolean;
      status?: string;
      siteUrlId?: string;
      observed?: boolean;
      fetchedAt?: Date | RawBuilder<Date>;
    } = {},
  ) {
    const identity = canonicalIdentity(path, seed.root);
    const now = new Date();
    const id = options.siteUrlId ?? randomUUID();
    if (!options.siteUrlId)
      await this.siteDb
        .insertInto('site_urls')
        .values({
          id,
          workspace_id: seed.workspaceId,
          project_id: seed.projectId,
          url_hash: identity.hash,
          normalized_url: identity.url,
          display_url: identity.url,
          host: 'example.test',
          item_kind: 'page',
          depth: 0,
          discovery_status: 'completed',
          corpus_disposition: 'eligible',
          disposition_reason: '',
          disposition_version: 'fixture',
          first_seen_at: now,
          last_seen_at: now,
          first_seen_crawl_id: seed.crawlId,
          last_seen_crawl_id: seed.crawlId,
          latest_content_type: 'text/html',
          latest_source_kind: 'root',
          latest_title: '',
        })
        .execute();
    const taskId = await this.task(seed, 'analyze');
    const artifactId = randomUUID();
    await this.siteDb
      .insertInto('site_fetch_artifacts')
      .values({
        id: artifactId,
        workspace_id: seed.workspaceId,
        crawl_id: seed.crawlId,
        task_id: taskId,
        requested_url: identity.url,
        final_url: identity.url,
        status_code: 200,
        content_type: 'text/html',
        content_hash: randomUUID().replaceAll('-', ''),
        normalized_facts: JSON.stringify(facts),
        extractor_version: policy.site_health.versions.extractor,
        fetched_at: options.fetchedAt ?? now,
        created_at: now,
        fetch_purpose: 'analyze',
        acquisition_policy_version: 'fixture',
        acquisition_transport: 'recorded',
        acquisition_trigger: 'fixture',
        http_version: 'HTTP/1.1',
        impersonation_profile: '',
      })
      .execute();
    await this.siteDb
      .updateTable('site_crawl_tasks')
      .set({ status: 'succeeded', site_url_id: id, result_artifact_id: artifactId })
      .where('id', '=', taskId)
      .execute();
    if (options.observed)
      await this.siteDb
        .insertInto('site_url_observations')
        .values({
          id: randomUUID(),
          workspace_id: seed.workspaceId,
          project_id: seed.projectId,
          crawl_id: seed.crawlId,
          site_url_id: id,
          source_kind: 'link',
          observed_url: identity.url,
          final_url: identity.url,
          status_code: 200,
          content_type: 'text/html',
          depth: 0,
          title: '',
          rewrite_reason: '',
          rewrite_version: '',
          value_kind: '',
          value_priority: 0,
          created_at: now,
        })
        .execute();
    const analysisId = randomUUID();
    await this.siteDb
      .insertInto('site_page_analyses')
      .values({
        id: analysisId,
        workspace_id: seed.workspaceId,
        project_id: seed.projectId,
        crawl_id: seed.crawlId,
        site_url_id: id,
        artifact_id: artifactId,
        status: options.status ?? 'completed',
        is_current: options.current ?? true,
        page_kind: path === '/' ? 'homepage' : 'product',
        analyzer_version: policy.site_health.versions.analyzer,
        scoring_version: 'fixture',
        profile_version: 'fixture',
        traits_version: 'fixture',
        classifier_version: 'fixture',
        presentation_version: 'fixture',
        schema_contract_version: 'fixture',
        aeo_measurement_state: 'unknown',
        aeo_measurement_reason: 'fixture',
        web_fundamentals_state: 'unknown',
        technical_critical_complete: false,
        technical_determinate_weight: 0,
        technical_earned_weight: 0,
        technical_expected_weight: 0,
        created_at: now,
      })
      .execute();
    return { id, artifactId, taskId, analysisId };
  }

  /** A monitored page with its queued analyze task, under a runtime entitled to analyze. */
  async analyzable(
    seed: SiteSeed,
    path: string,
    options: { source?: string; monitoredLimit?: number; createdAt?: Date } = {},
  ) {
    const identity = canonicalIdentity(path, seed.root);
    const now = new Date();
    const siteUrlId = randomUUID();
    await this.siteDb
      .insertInto('workspace_site_health_runtime')
      .values({
        id: randomUUID(),
        workspace_id: seed.workspaceId,
        monitored_url_limit: options.monitoredLimit ?? 50,
        sample_url_limit: 10,
        discovery_mode: 'full',
        count_disclosure: true,
        resolved_entitlement_lifecycle_version: 1,
        resolved_registry_revision: 'fixture',
        created_at: now,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc
          .column('workspace_id')
          .doUpdateSet({ monitored_url_limit: options.monitoredLimit ?? 50 }),
      )
      .execute();
    await this.siteDb
      .insertInto('site_urls')
      .values({
        id: siteUrlId,
        workspace_id: seed.workspaceId,
        project_id: seed.projectId,
        url_hash: identity.hash,
        normalized_url: identity.url,
        display_url: identity.url,
        host: 'example.test',
        item_kind: 'page',
        depth: 0,
        discovery_status: 'pending',
        corpus_disposition: 'eligible',
        disposition_reason: '',
        disposition_version: 'fixture',
        first_seen_at: now,
        last_seen_at: now,
        first_seen_crawl_id: seed.crawlId,
        last_seen_crawl_id: seed.crawlId,
        latest_content_type: '',
        latest_source_kind: 'root',
        latest_title: '',
      })
      .execute();
    await this.siteDb
      .insertInto('monitored_site_urls')
      .values({
        id: randomUUID(),
        workspace_id: seed.workspaceId,
        project_id: seed.projectId,
        profile_id: seed.profileId,
        site_url_id: siteUrlId,
        active: true,
        selection_source: options.source ?? 'user',
        selected_at: now,
        created_at: now,
        updated_at: now,
      })
      .execute();
    const taskId = await this.task(seed, 'analyze');
    await this.siteDb
      .updateTable('site_crawl_tasks')
      .set({
        site_url_id: siteUrlId,
        url_hash: identity.hash,
        requested_url: identity.url,
        created_at: options.createdAt ?? now,
      })
      .where('id', '=', taskId)
      .execute();
    return { siteUrlId, taskId, url: identity.url, hash: identity.hash };
  }
  /** A discover task for the URL hash, in `status`, with a discover artifact when it succeeded. */
  async discover(
    seed: SiteSeed,
    urlHash: string,
    status: string,
    facts: Record<string, unknown> | null,
  ) {
    const taskId = await this.task(seed, 'discover');
    await this.siteDb
      .updateTable('site_crawl_tasks')
      .set({ url_hash: urlHash, status })
      .where('id', '=', taskId)
      .execute();
    if (!facts) return { taskId, artifactId: null };
    const artifactId = randomUUID();
    const now = new Date();
    await this.siteDb
      .insertInto('site_fetch_artifacts')
      .values({
        id: artifactId,
        workspace_id: seed.workspaceId,
        crawl_id: seed.crawlId,
        task_id: taskId,
        requested_url: seed.root,
        final_url: seed.root,
        status_code: 200,
        content_type: 'text/html',
        content_hash: randomUUID().replaceAll('-', ''),
        normalized_facts: JSON.stringify(facts),
        extractor_version: policy.site_health.versions.extractor,
        fetched_at: now,
        created_at: now,
        fetch_purpose: 'discover',
        acquisition_policy_version: 'fixture',
        acquisition_transport: 'recorded',
        acquisition_trigger: 'fixture',
        http_version: 'HTTP/1.1',
        impersonation_profile: '',
      })
      .execute();
    return { taskId, artifactId };
  }

  async snapshot(seed: SiteSeed, coverage = 'partial') {
    const id = randomUUID();
    const versions = policy.site_health.versions;
    await this.siteDb
      .insertInto('site_health_snapshots')
      .values({
        id,
        workspace_id: seed.workspaceId,
        project_id: seed.projectId,
        crawl_id: seed.crawlId,
        created_at: new Date(),
        analyzed_url_count: 0,
        selected_url_count: 0,
        issue_count: 0,
        technical_defect_count: 0,
        technical_defect_affected_page_count: 0,
        aeo_readiness_gap_count: 0,
        aeo_readiness_gap_affected_page_count: 0,
        aeo_measurement_state: 'unknown',
        aeo_readiness_diagnostic: '{}',
        classified_page_count: 0,
        other_page_count: 0,
        classification_expected_page_count: 0,
        classification_error_page_count: 0,
        classification_state: 'unknown',
        classification_formula_version: 'fixture',
        coverage_state: coverage,
        coverage_formula_version: 'fixture',
        search_eligibility: 'unknown',
        web_fundamentals_state: 'unknown',
        analyzer_version: versions.analyzer,
        scoring_version: 'fixture',
        profile_version: 'fixture',
        presentation_version: 'fixture',
        schema_contract_version: 'fixture',
      })
      .execute();
    return id;
  }
  async evaluation(
    seed: SiteSeed,
    page: { analysisId: string; artifactId: string },
    ruleId: string,
    outcome: string,
  ) {
    const rule = policy.site_health.rule_catalog.find((item) => item.rule_id === ruleId);
    if (!rule) throw new Error(`Unknown rule: ${ruleId}`);
    const id = randomUUID();
    await this.siteDb
      .insertInto('site_rule_evaluations')
      .values({
        id,
        workspace_id: seed.workspaceId,
        analysis_id: page.analysisId,
        source_artifact_id: page.artifactId,
        rule_id: ruleId,
        rule_version: rule.rule_version,
        dimension: rule.dimension,
        category: rule.category,
        severity: rule.severity,
        finding_class: rule.finding_class,
        scope: rule.scope,
        weight: rule.weight,
        outcome,
        display_applicability: true,
        score_applicability: true,
        reason_code: 'fixture',
        readiness_dimension: '',
        readiness_weight: 0,
        analyzer_version: policy.site_health.versions.analyzer,
        extractor_version: policy.site_health.versions.extractor,
        created_at: new Date(),
      })
      .execute();
    await this.siteDb
      .updateTable('site_page_analyses')
      .set({ source_evaluation_ids: [id] })
      .where('id', '=', page.analysisId)
      .where('workspace_id', '=', seed.workspaceId)
      .execute();
    return id;
  }
  async businessProfile(seed: SiteSeed, context: Record<string, unknown>) {
    const brand = randomUUID();
    const profile = randomUUID();
    const now = new Date();
    await this.siteDb
      .insertInto('brands')
      .values({
        id: brand,
        project_id: seed.projectId,
        name: 'Fixture',
        created_at: now,
        updated_at: now,
      })
      .execute();
    await this.siteDb
      .insertInto('brand_profiles')
      .values({
        id: profile,
        workspace_id: seed.workspaceId,
        project_id: seed.projectId,
        brand_id: brand,
        business_context: JSON.stringify(context),
        description: '',
        positioning: '',
        target_audience: '',
        products_services: '[]',
        sources: '[]',
        source_artifact_ids: '[]',
        created_at: now,
        updated_at: now,
      })
      .execute();
    return profile;
  }
}

export type Served = {
  headers?: Record<string, string>;
  status?: number;
  body?: string | Buffer;
  redirect?: string;
  contentType?: string;
  onFetch?: () => Promise<void>;
};
/**
 * A recorded site (keyed by path) behind the real acquirer: robots and pacing
 * run through the gate, every hop is authorized, and each call is reported
 * like the transport does. `requests` collects the paths actually sent.
 */
export function recordedSite(
  pages: Record<string, Served>,
  requests: string[] = [],
): WebsiteFetcher {
  return async (value: string, options: FetchOptions): Promise<FetchedPage> => {
    let url = new URL(value);
    for (let hop = 0; hop <= options.redirects; hop++) {
      const target = url;
      const served = pages[target.pathname];
      const send = async () => {
        // Match the real transport: gate first, authorization immediately before send.
        await options.authorize?.(target);
        requests.push(target.pathname);
        await served?.onFetch?.();
        const status = served?.status ?? (served ? 200 : 404);
        const body = Buffer.from(served?.body ?? '');
        options.onCall?.({
          url: target.href,
          status,
          error: null,
          wireBytes: body.length,
          decodedBytes: body.length,
          ttfbMs: 1,
          latencyMs: 1,
        });
        return { status, body, redirect: served?.redirect };
      };
      const response = options.gate
        ? await options.gate(target, send, AbortSignal.timeout(5000))
        : await send();
      if (!response.redirect)
        return {
          url: target.href,
          status: response.status,
          contentType: served?.contentType ?? 'text/html',
          headers: served?.headers,
          body: response.body,
        };
      url = new URL(response.redirect, target);
    }
    throw new FetchError('redirect_limit');
  };
}
