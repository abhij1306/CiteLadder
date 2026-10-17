/**
 * Persisted measurement rows for the visibility read tests.
 *
 * Every NOT NULL column without a schema default gets an explicit value. Rows are
 * removed per workspace in `cleanup`, children before parents.
 */
import { randomUUID } from 'node:crypto';
import { fanoutProjection } from '../src/analysis/fanout.ts';

import type { Database } from '../src/db/database.ts';
import { Fixtures } from './support.ts';

const now = () => new Date();

export type Json = Parameters<typeof JSON.stringify>[0];

export type Tenant = { userId: string; workspaceId: string; projectId: string };

export type ObservationInput = {
  outcome?: string;
  aioPresent?: boolean | null;
  links?: string[];
  observedAt?: Date | null;
};

export type ExecutionInput = {
  auditId: string;
  engine?: string;
  transportModel?: string;
  transportProvider?: string;
  answerText?: string;
  promptIndex?: number;
  promptText?: string;
  theme?: string;
  cohort?: string;
  taskStatus?: string;
  repetition?: number;
  /** Stored search events on the task, and on its immutable artifact. */
  taskEvents?: Json;
  artifactEvents?: Json;
  providerMetadata?: Json;
  /** Null: the task never produced an analysis (a failed retrieval). */
  analysis?: {
    brandMentioned?: boolean;
    brandFirstOffset?: number | null;
    ownedCited?: boolean;
    avgPosition?: number | null;
    searchUsed?: boolean;
    searchQueryCount?: number;
    score?: Json;
    createdAt?: Date;
    citations?: {
      url: string;
      domain?: string;
      isOwned?: boolean;
      matched?: string | null;
      title?: string;
      sourceClass?: string | null;
      urlHash?: string | null;
    }[];
    brandMentions?: string[];
    competitorMentions?: string[];
    /** Pages the answer read; omitted means the surface exposed no reads. */
    retrieved?: { url: string; isOwned?: boolean; urlHash?: string | null }[];
  } | null;
  observation?: ObservationInput;
};

const TABLES_BY_WORKSPACE = [
  'opportunities',
  'metric_snapshots',
  'prompt_metric_snapshots',
  'aio_entity_links',
  'aio_observations',
  'retrieved_sources',
  'citations',
  'brand_mentions',
  'competitor_mentions',
  'response_analyses',
] as const;

export class VisibilityFixtures extends Fixtures {
  private readonly database: Database;
  private readonly tenants: Tenant[] = [];
  private readonly logos: string[] = [];
  private readonly promptIndexes = new Map<string, number>();

  constructor(db: Database) {
    super(db);
    this.database = db;
  }

  /** A user owning a workspace with one project. */
  async tenant(options: { websiteUrl?: string } = {}): Promise<Tenant> {
    const userId = await this.user();
    const workspaceId = await this.ownedWorkspace(userId);
    const projectId = await this.project(workspaceId, options.websiteUrl);
    const tenant = { userId, workspaceId, projectId };
    this.tenants.push(tenant);
    return tenant;
  }

  async project(workspaceId: string, websiteUrl = 'https://acme.example'): Promise<string> {
    const id = randomUUID();
    await this.database
      .insertInto('projects')
      .values({
        id,
        workspace_id: workspaceId,
        name: 'Acme',
        brand_name: 'Acme Corp',
        website_url: websiteUrl,
        industry: 'software',
        subindustry: 'analytics',
        primary_market: 'US',
        country_code: 'US',
        language_code: 'en',
        benchmark_mode: 'standard',
        default_repetitions: 1,
        created_at: now(),
        updated_at: now(),
      })
      .execute();
    return id;
  }

  /** A cached logo asset, which a brand or competitor mark points at. */
  private async logoAsset(): Promise<string> {
    const id = randomUUID();
    await this.database
      .insertInto('brand_logo_assets')
      .values({
        id,
        domain: `${id}.example`,
        source_url: '',
        status: 'ready',
        content_type: 'image/png',
        byte_size: 0,
        sha256: '',
        created_at: now(),
        updated_at: now(),
      })
      .execute();
    this.logos.push(id);
    return id;
  }

  async brand(projectId: string, name: string, logo = false): Promise<void> {
    await this.database
      .insertInto('brands')
      .values({
        id: randomUUID(),
        project_id: projectId,
        name,
        logo_asset_id: logo ? await this.logoAsset() : null,
        created_at: now(),
        updated_at: now(),
      })
      .execute();
  }

  async competitor(
    projectId: string,
    input: {
      name: string;
      aliases?: string[];
      domains?: string[];
      logo?: boolean;
      createdAt?: Date;
    },
  ): Promise<string> {
    const id = randomUUID();
    await this.database
      .insertInto('competitors')
      .values({
        id,
        project_id: projectId,
        name: input.name,
        aliases: JSON.stringify(input.aliases ?? []),
        domains: JSON.stringify(input.domains ?? []),
        logo_asset_id: input.logo ? await this.logoAsset() : null,
        created_at: input.createdAt ?? now(),
        updated_at: now(),
      })
      .execute();
    return id;
  }

  /** A dashboard-ready brand run with one engine snapshot per engine. */
  async audit(
    tenant: Tenant,
    options: {
      /** Null for an audit that has not settled. */
      completedAt?: Date | null;
      status?: string;
      configuration?: Json;
      scope?: string;
    } = {},
  ): Promise<string> {
    const id = randomUUID();
    await this.database
      .insertInto('audits')
      .values({
        id,
        workspace_id: tenant.workspaceId,
        project_id: tenant.projectId,
        status: options.status ?? 'completed',
        audit_scope: options.scope ?? 'brand',
        trigger: 'manual',
        benchmark_mode: '',
        system_instruction: '',
        repetitions: 1,
        random_seed: '',
        analyzer_version: 'test',
        requested_count: 0,
        completed_count: 0,
        failed_count: 0,
        error_message: '',
        configuration: JSON.stringify(options.configuration ?? {}),
        completed_at: options.completedAt === undefined ? now() : options.completedAt,
        created_at: now(),
        updated_at: now(),
      })
      .execute();
    return id;
  }

  private async engineSnapshot(
    auditId: string,
    engine: string,
    model: string,
    provider: string,
  ): Promise<string> {
    const existing = await this.database
      .selectFrom('audit_engine_snapshots')
      .select('id')
      .where('audit_id', '=', auditId)
      .where('logical_engine', '=', engine)
      .executeTakeFirst();
    if (existing) return existing.id;
    const id = randomUUID();
    await this.database
      .insertInto('audit_engine_snapshots')
      .values({
        id,
        audit_id: auditId,
        logical_engine: engine,
        transport_provider: provider,
        transport_model: model,
        base_url: '',
        created_at: now(),
      })
      .execute();
    return id;
  }

  /** One execution: prompt snapshot, task, and optionally analysis and observation. */
  async execution(
    tenant: Tenant,
    input: ExecutionInput,
  ): Promise<{ taskId: string; analysisId: string | null }> {
    const engine = input.engine ?? 'chatgpt';
    const model = input.transportModel ?? 'test-model';
    const provider = input.transportProvider ?? 'test';
    // One prompt snapshot per (run, index): unnamed indexes count up per run.
    const promptIndex = input.promptIndex ?? this.promptIndexes.get(input.auditId) ?? 0;
    this.promptIndexes.set(
      input.auditId,
      Math.max(promptIndex + 1, this.promptIndexes.get(input.auditId) ?? 0),
    );
    // A run freezes each prompt once; its other executions share the snapshot.
    const existing = await this.database
      .selectFrom('audit_prompt_snapshots')
      .select('id')
      .where('audit_id', '=', input.auditId)
      .where('prompt_index', '=', promptIndex)
      .executeTakeFirst();
    const snapshotId = existing?.id ?? randomUUID();
    if (existing === undefined) {
      await this.database
        .insertInto('audit_prompt_snapshots')
        .values({
          id: snapshotId,
          audit_id: input.auditId,
          prompt_index: promptIndex,
          text: input.promptText ?? `prompt ${promptIndex}`,
          theme: input.theme ?? '',
          intent: '',
          buyer_stage: '',
          prompt_intent: '',
          cohort: input.cohort ?? 'core',
          created_at: now(),
        })
        .execute();
    }
    const taskId = randomUUID();
    await this.database
      .insertInto('audit_tasks')
      .values({
        id: taskId,
        audit_id: input.auditId,
        workspace_id: tenant.workspaceId,
        project_id: tenant.projectId,
        prompt_snapshot_id: snapshotId,
        engine_snapshot_id: await this.engineSnapshot(input.auditId, engine, model, provider),
        prompt_index: promptIndex,
        repetition: input.repetition ?? 0,
        randomized_position: 0,
        logical_engine: engine,
        transport_provider: provider,
        transport_model: model,
        prompt_text: input.promptText ?? `prompt ${promptIndex}`,
        idempotency_key: taskId,
        status: input.taskStatus ?? 'succeeded',
        priority: 0,
        available_at: now(),
        attempt_count: 0,
        max_attempts: 5,
        answer_text: input.answerText ?? '',
        search_used: false,
        search_events: input.taskEvents === undefined ? null : JSON.stringify(input.taskEvents),
        provider_metadata:
          input.providerMetadata === undefined ? null : JSON.stringify(input.providerMetadata),
        finish_reason: 'unknown',
        error_code: '',
        error_detail: '',
        created_at: now(),
        updated_at: now(),
      })
      .execute();
    const analysisId =
      input.analysis === null
        ? null
        : await this.analysis(tenant, { ...input, promptIndex }, taskId, engine, model);
    if (input.observation) await this.observation(tenant, input.auditId, taskId, input.observation);
    return { taskId, analysisId };
  }

  private async analysis(
    tenant: Tenant,
    input: ExecutionInput,
    taskId: string,
    engine: string,
    model: string,
  ): Promise<string> {
    const spec = input.analysis ?? {};
    const artifactId = randomUUID();
    await this.database
      .insertInto('raw_response_artifacts')
      .values({
        id: artifactId,
        audit_id: input.auditId,
        task_id: taskId,
        logical_engine: engine,
        transport_provider: input.transportProvider ?? 'test',
        transport_model: model,
        answer_text: input.answerText ?? '',
        search_used: false,
        search_events:
          input.artifactEvents === undefined ? null : JSON.stringify(input.artifactEvents),
        finish_reason: 'unknown',
        created_at: now(),
      })
      .execute();
    const id = randomUUID();
    const citations = spec.citations ?? [];
    await this.database
      .insertInto('response_analyses')
      .values({
        id,
        workspace_id: tenant.workspaceId,
        audit_id: input.auditId,
        task_id: taskId,
        artifact_id: artifactId,
        analyzer_version: 'test',
        scoring_rule_version: 'test',
        logical_engine: engine,
        transport_provider: input.transportProvider ?? 'test',
        transport_model: model,
        prompt_index: input.promptIndex ?? 0,
        repetition: input.repetition ?? 0,
        prompt_class: '',
        cohort: input.cohort ?? 'core',
        brand_mentioned: spec.brandMentioned ?? false,
        brand_first_offset: spec.brandFirstOffset ?? null,
        owned_domain_cited: spec.ownedCited ?? false,
        owned_citation_count: spec.ownedCited ? 1 : 0,
        unintended_domain_cited: false,
        citation_count: citations.length,
        avg_position: spec.avgPosition ?? null,
        search_used: spec.searchUsed ?? false,
        search_query_count: spec.searchQueryCount ?? 0,
        ...fanoutProjection({
          artifactEvents: input.artifactEvents,
          taskEvents: input.taskEvents,
          searchUsed: spec.searchUsed ?? false,
          searchQueryCount: spec.searchQueryCount ?? 0,
          providerMetadata: input.providerMetadata,
        }),
        entity_assessments: JSON.stringify([]),
        score: spec.score === undefined ? null : JSON.stringify(spec.score),
        retrieval_observed: spec.retrieved !== undefined,
        created_at: spec.createdAt ?? now(),
      })
      .execute();
    const mention = {
      workspace_id: tenant.workspaceId,
      audit_id: input.auditId,
      artifact_id: artifactId,
      analyzer_version: 'test',
      analysis_id: id,
      created_at: now(),
    };
    for (const name of spec.brandMentions ?? []) {
      await this.database
        .insertInto('brand_mentions')
        .values({ ...mention, id: randomUUID(), brand_name: name })
        .execute();
    }
    for (const name of spec.competitorMentions ?? []) {
      await this.database
        .insertInto('competitor_mentions')
        .values({ ...mention, id: randomUUID(), competitor_name: name })
        .execute();
    }
    for (const [ordinal, citation] of citations.entries()) {
      await this.database
        .insertInto('citations')
        .values({
          ...mention,
          id: randomUUID(),
          ordinal,
          url: citation.url,
          domain: citation.domain ?? new URL(citation.url).hostname,
          title: citation.title ?? '',
          classification: 'third_party',
          source_class: citation.sourceClass ?? null,
          url_hash: citation.urlHash ?? null,
          is_owned: citation.isOwned ?? false,
          is_unintended: false,
          matched_competitor: citation.matched ?? null,
        })
        .execute();
    }
    for (const [ordinal, source] of (spec.retrieved ?? []).entries()) {
      await this.database
        .insertInto('retrieved_sources')
        .values({
          ...mention,
          id: randomUUID(),
          ordinal,
          url: source.url,
          domain: new URL(source.url).hostname,
          title: '',
          is_owned: source.isOwned ?? false,
          url_hash: source.urlHash ?? null,
        })
        .execute();
    }
    return id;
  }

  private async observation(
    tenant: Tenant,
    auditId: string,
    taskId: string,
    input: ObservationInput,
  ): Promise<void> {
    const id = randomUUID();
    const present = input.aioPresent === undefined ? true : input.aioPresent;
    await this.database
      .insertInto('aio_observations')
      .values({
        id,
        workspace_id: tenant.workspaceId,
        audit_id: auditId,
        task_id: taskId,
        outcome: input.outcome ?? 'ai_overview_present',
        aio_present: present,
        aio_serp_position: present ? 1 : null,
        location_code: 2036,
        language_code: 'en',
        device: 'desktop',
        element_count: 3,
        observed_at: input.observedAt ?? null,
        retrieved_at: now(),
        created_at: now(),
      })
      .execute();
    for (const [index, url] of (input.links ?? []).entries()) {
      await this.database
        .insertInto('aio_entity_links')
        .values({
          id: randomUUID(),
          workspace_id: tenant.workspaceId,
          observation_id: id,
          url,
          domain: new URL(url).hostname,
          title: '',
          element_index: index,
          created_at: now(),
        })
        .execute();
    }
  }

  /** A run's persisted aggregate, as analysis finalization writes it. */
  async metricSnapshot(
    tenant: Tenant,
    auditId: string,
    input: {
      metrics: Json;
      visibilityScore?: number;
      analyzerVersion?: string;
      scoringRuleVersion?: string;
    },
  ): Promise<string> {
    const id = randomUUID();
    await this.database
      .insertInto('metric_snapshots')
      .values({
        id,
        workspace_id: tenant.workspaceId,
        project_id: tenant.projectId,
        audit_id: auditId,
        analyzer_version: input.analyzerVersion ?? 'test',
        scoring_rule_version: input.scoringRuleVersion ?? 'test',
        total_completed: 0,
        total_failed: 0,
        visibility_score: input.visibilityScore ?? 0,
        metrics: JSON.stringify(input.metrics),
        source_analysis_ids: JSON.stringify([]),
        source_artifact_ids: JSON.stringify([]),
        created_at: now(),
      })
      .execute();
    return id;
  }

  /** One prompt's persisted score for a run. */
  async promptScore(
    tenant: Tenant,
    auditId: string,
    input: {
      promptIndex: number;
      promptText: string;
      composite: number;
      cohort?: string;
      promptId?: string;
    },
  ): Promise<string> {
    const id = randomUUID();
    await this.database
      .insertInto('prompt_metric_snapshots')
      .values({
        id,
        workspace_id: tenant.workspaceId,
        project_id: tenant.projectId,
        audit_id: auditId,
        prompt_id: input.promptId ?? null,
        prompt_identity: input.promptText,
        prompt_index: input.promptIndex,
        prompt_text: input.promptText,
        cohort: input.cohort ?? 'core',
        composite_score: input.composite,
        previous_score: null,
        immediate_delta: null,
        rolling_four: JSON.stringify([input.composite]),
        per_engine_scores: JSON.stringify({}),
        components: JSON.stringify({ visibility: null }),
        engine_agreement: 1,
        repetition_agreement: 1,
        evidence_coverage: 1,
        trend_confidence: 1,
        decline_confirmed: false,
        analyzer_version: 'test',
        scoring_rule_version: 'test',
        source_analysis_ids: JSON.stringify([]),
        source_artifact_ids: JSON.stringify([]),
        created_at: now(),
      })
      .execute();
    return id;
  }

  /** A page this project knows, optionally with a live action on it. */
  async sourcePage(
    tenant: Tenant,
    input: { urlHash: string; url: string; pageFormat?: string; action?: string },
  ): Promise<void> {
    await this.database
      .insertInto('source_pages')
      .values({
        id: randomUUID(),
        workspace_id: tenant.workspaceId,
        project_id: tenant.projectId,
        url_hash: input.urlHash,
        canonical_url: input.url,
        registrable_domain: new URL(input.url).hostname,
        inspection_state: 'inspected',
        page_format: input.pageFormat ?? 'article',
        page_format_method: 'page',
        recurrence_count: 1,
        created_at: now(),
        updated_at: now(),
      })
      .execute();
    if (input.action === undefined) return;
    await this.database
      .insertInto('opportunities')
      .values({
        id: input.action,
        workspace_id: tenant.workspaceId,
        project_id: tenant.projectId,
        opportunity_type: 'earned',
        rule_id: 'test-rule',
        rule_version: '1',
        analyzer_version: 'test',
        formula_version: 'test',
        severity: 'medium',
        priority_score: 1,
        title: 'Fix the page',
        remediation: '',
        target_key: `earned-page:${input.urlHash}`,
        created_at: now(),
        updated_at: now(),
      })
      .execute();
  }

  async referralSnapshot(
    tenant: Tenant,
    input: {
      windowStart: string;
      windowEnd: string;
      sessions: number;
      presetDays?: number | null;
      granularity?: string;
    },
  ): Promise<void> {
    await this.database
      .insertInto('ai_referrals_snapshots')
      .values({
        id: randomUUID(),
        workspace_id: tenant.workspaceId,
        project_id: tenant.projectId,
        window_start: input.windowStart,
        window_end: input.windowEnd,
        granularity: input.granularity ?? 'day',
        preset_window_days: input.presetDays ?? null,
        analyzer_version: 'ai-referrals-v1',
        formula_version: 'ai-referral-sessions-v1',
        metrics: JSON.stringify({
          referral_volume: [{ date: input.windowEnd, value: input.sessions }],
          referral_share: [],
          sources: [{ ai_source: 'chatgpt', sessions: input.sessions }],
        }),
        source_classification_ids: JSON.stringify([]),
        created_at: now(),
      })
      .execute();
  }

  override async cleanup(): Promise<void> {
    const workspaces = this.tenants.map((tenant) => tenant.workspaceId);
    if (workspaces.length) {
      for (const table of TABLES_BY_WORKSPACE) {
        await this.database.deleteFrom(table).where('workspace_id', 'in', workspaces).execute();
      }
      const audits = this.database
        .selectFrom('audits')
        .select('id')
        .where('workspace_id', 'in', workspaces);
      await this.database
        .deleteFrom('raw_response_artifacts')
        .where('audit_id', 'in', audits)
        .execute();
      await this.database
        .deleteFrom('audit_tasks')
        .where('workspace_id', 'in', workspaces)
        .execute();
      await this.database
        .deleteFrom('audit_prompt_snapshots')
        .where('audit_id', 'in', audits)
        .execute();
      await this.database
        .deleteFrom('audit_engine_snapshots')
        .where('audit_id', 'in', audits)
        .execute();
      await this.database.deleteFrom('audits').where('workspace_id', 'in', workspaces).execute();
      await this.database
        .deleteFrom('ai_referrals_snapshots')
        .where('workspace_id', 'in', workspaces)
        .execute();
      await this.database
        .deleteFrom('source_pages')
        .where('workspace_id', 'in', workspaces)
        .execute();
      const projects = this.database
        .selectFrom('projects')
        .select('id')
        .where('workspace_id', 'in', workspaces);
      await this.database.deleteFrom('brands').where('project_id', 'in', projects).execute();
      await this.database.deleteFrom('competitors').where('project_id', 'in', projects).execute();
      await this.database.deleteFrom('projects').where('workspace_id', 'in', workspaces).execute();
    }
    if (this.logos.length) {
      await this.database.deleteFrom('brand_logo_assets').where('id', 'in', this.logos).execute();
    }
    await super.cleanup();
  }
}
