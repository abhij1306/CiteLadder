import { randomUUID } from 'node:crypto';

import {
  brandDiscoverySchema,
  brandDiscoveryCompleteSchema,
} from '@citeladder/contracts/visibility';
import type { Selectable } from 'kysely';
import { z } from 'zod';

import { dailyWorkspaceLimit, enforceWorkspaceRequest } from '../abuse/usage.ts';
import { activeJobRetrySeconds, policy, resolveSettingSpec } from '../config.ts';
import { subjectXactLock } from '../db/advisory-lock.ts';
import type { Database } from '../db/database.ts';
import { jsonObject } from '../db/json.ts';
import { ApiError, notFound } from '../errors.ts';
import type { BrandDiscoveries } from '../generated/db-schema.ts';
import { cleanList, projectCreate } from './inputs.ts';
import {
  discoverySettings,
  type DiscoveryCompletion,
  type DiscoveryInput,
} from './discovery-inputs.ts';
import { websiteIdentity } from './safe-fetch.ts';
import { insertProject } from './service.ts';

export type DiscoveryRow = Selectable<BrandDiscoveries>;
const cfg = policy.discovery.constants;
export function discoveryProgress(phase: string, completed: number, pages = 0, competitors = 0) {
  return {
    phase,
    completed_steps: completed,
    total_steps: cfg.discovery_progress_total_steps,
    pages_read: pages,
    competitors_found: competitors,
    updated_at: new Date().toISOString(),
  };
}
export function discoveryView(row: DiscoveryRow) {
  return brandDiscoverySchema.parse({
    ...row,
    profile: {
      description: '',
      positioning: '',
      products_services: [],
      target_audience: '',
      industry: 'General',
      business_type: null,
      price_tier: 'unknown',
      field_confidence: {},
      ...jsonObject(row.profile, 'discovery.profile'),
    },
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  });
}
export async function discoveryRow(db: Database, workspaceId: string, id: string, lock = false) {
  let query = db
    .selectFrom('brand_discoveries')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', id);
  if (lock) query = query.forUpdate();
  const row = await query.executeTakeFirst();
  if (!row) throw notFound('Brand discovery');
  return row;
}
export function discoveryCatalog() {
  const industries = policy.discovery.industry_library.industries;
  return {
    maximum_competitors: discoverySettings().maximum_competitors,
    industries: Object.keys(industries),
    subindustries: Object.fromEntries(
      Object.entries(industries).map(([name, context]) => [
        name,
        'subindustries' in context ? context.subindustries : [],
      ]),
    ),
  };
}
/**
 * Discovery spends outbound fetches, model calls and research-provider calls,
 * so a workspace holds a bounded number at once and per day. A replayed
 * idempotency key returns before this and spends nothing.
 */
async function admitDiscovery(trx: Database, workspaceId: string) {
  const active = await trx
    .selectFrom('brand_discovery_tasks')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('workspace_id', '=', workspaceId)
    .where('status', 'in', policy.task_queue.active)
    .executeTakeFirstOrThrow();
  if (
    Number(active.count) >=
    Number(resolveSettingSpec(policy.abuse.active_brand_discoveries_per_workspace))
  )
    throw new ApiError(429, 'Workspace active brand discovery limit exceeded', {
      headers: { 'retry-after': String(activeJobRetrySeconds()) },
    });
  await enforceWorkspaceRequest(
    trx,
    workspaceId,
    dailyWorkspaceLimit('brand_discovery.create', 'brand_discoveries_per_workspace_daily'),
  );
}
export function createDiscovery(
  db: Database,
  workspaceId: string,
  input: DiscoveryInput,
  key: string,
) {
  return db.transaction().execute(async (trx) => {
    // Locked before the replay lookup, so a concurrent retry of the same key
    // sees the first request's row instead of spending a second admission.
    await subjectXactLock(trx, `brand-discovery-admission:${workspaceId}`);
    const existing = await trx
      .selectFrom('brand_discoveries')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('idempotency_key', '=', key)
      .executeTakeFirst();
    if (existing) return discoveryView(existing);
    await admitDiscovery(trx, workspaceId);
    const industries: Record<string, { subindustries?: string[] }> =
      policy.discovery.industry_library.industries;
    if (!Object.hasOwn(industries, input.industry))
      throw new ApiError(422, 'industry is not supported');
    if (
      input.subindustry &&
      !(industries[input.industry]!.subindustries ?? []).includes(input.subindustry)
    )
      throw new ApiError(422, 'subindustry is not valid for the selected industry');
    let identity;
    try {
      identity = websiteIdentity(input.website_url);
    } catch {
      throw new ApiError(422, 'website_url must use a public HTTP(S) domain');
    }
    const now = new Date();
    const id = randomUUID();
    const inserted = await trx
      .insertInto('brand_discoveries')
      .values({
        id,
        workspace_id: workspaceId,
        project_id: null,
        initial_crawl_id: null,
        idempotency_key: key,
        status: cfg.discovery_status_queued,
        stage: 'queued',
        input_data: JSON.stringify({
          ...input,
          website_url: identity.url,
          discovery_version: cfg.brand_discovery_version,
        }),
        profile: '{}',
        domains: '[]',
        competitors: '[]',
        topics: '[]',
        prompt_suggestions: '[]',
        evidence: '[]',
        gaps: '[]',
        warnings: '[]',
        progress: JSON.stringify(discoveryProgress('opening_website', 0)),
        error_code: '',
        error_detail: '',
        created_at: now,
        updated_at: now,
      })
      .onConflict((conflict) => conflict.constraint('uq_brand_discovery_idempotency').doNothing())
      .returningAll()
      .executeTakeFirst();
    if (!inserted) {
      const replay = await trx
        .selectFrom('brand_discoveries')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('idempotency_key', '=', key)
        .executeTakeFirstOrThrow();
      return discoveryView(replay);
    }
    await trx
      .insertInto('brand_discovery_tasks')
      .values({
        id: randomUUID(),
        workspace_id: workspaceId,
        discovery_id: id,
        task_kind: cfg.task_kind_brand_discovery,
        idempotency_key: `brand-discovery:${id}`,
        status: policy.task_queue.statuses.queued,
        attempt_count: 0,
        max_attempts: discoverySettings().maximum_attempts,
        available_at: now,
        priority: 0,
        randomized_position: 0,
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: null,
        completed_at: null,
        error_code: '',
        error_detail: '',
        created_at: now,
        updated_at: now,
      })
      .execute();
    return discoveryView(inserted);
  });
}
function confirmedCompetitors(input: DiscoveryCompletion, brandName: string, owned: string[]) {
  const names = new Set([brandName.toLowerCase()]);
  const seenDomains = new Set(owned);
  return input.competitors.map((item) => {
    if (names.has(item.name.toLowerCase()))
      throw new ApiError(409, 'Competitors must be unique and distinct from the brand');
    names.add(item.name.toLowerCase());
    const domains = [...new Set(item.domains.map((domain) => websiteIdentity(domain).domain))];
    if (!domains.length || domains.some((domain) => seenDomains.has(domain)))
      throw new ApiError(409, 'Competitors must have a distinct public domain');
    for (const domain of domains) seenDomains.add(domain);
    return { ...item, aliases: cleanList(item.aliases), domains };
  });
}
function businessContext(input: DiscoveryCompletion, data: Record<string, unknown>) {
  const {
    business_type,
    field_confidence: _confidence,
    category_options: _options,
    ...facts
  } = input.profile;
  const values = {
    ...facts,
    buyer_type: business_type,
    primary_market: data.primary_market,
    language_code: data.language_code,
    business_map: { offerings: [] },
  };
  const reviewed = new Set([
    'category',
    'buyer_type',
    'market_scope',
    'primary_market',
    'language_code',
  ]);
  return {
    ...values,
    field_sources: Object.fromEntries(
      Object.entries(values)
        .filter(
          ([, value]) => value != null && value !== '' && !(Array.isArray(value) && !value.length),
        )
        .map(([field]) => [field, reviewed.has(field) ? 'reviewed' : 'inferred']),
    ),
  };
}
function completionView(row: DiscoveryRow) {
  return brandDiscoveryCompleteSchema.parse({
    discovery_id: row.id,
    project_id: row.project_id,
    warnings: row.warnings,
  });
}
function replay(row: DiscoveryRow, key: string) {
  const existing = jsonObject(row.input_data, 'discovery.input_data').completion_idempotency_key;
  if (!existing) return false;
  if (existing !== key)
    throw new ApiError(409, 'Discovery was completed with another Idempotency-Key');
  return true;
}
export function seedBrandAliases(brandName: string, domains: string[]) {
  const compact = (value: string) =>
    value
      .toLowerCase()
      .replaceAll('&', 'and')
      .replaceAll(/[^\p{L}\p{N}]/gu, '');
  const brand = compact(brandName);
  return [
    ...new Set(
      domains
        .map((domain) => domain.split('.')[0]!)
        .filter((label) => {
          const alias = compact(label);
          return (
            label.toLowerCase() !== brandName.trim().toLowerCase() &&
            Math.min(alias.length, brand.length) >= 4 &&
            (brand.startsWith(alias) || alias.startsWith(brand))
          );
        }),
    ),
  ];
}
export async function completeDiscovery(
  db: Database,
  workspaceId: string,
  userId: string,
  id: string,
  input: DiscoveryCompletion,
  key: string,
) {
  const before = await discoveryRow(db, workspaceId, id);
  if (replay(before, key)) return completionView(before);
  const data = jsonObject(before.input_data, 'discovery.input_data');
  let domains: string[];
  let competitors;
  try {
    domains = [...new Set(input.domains.map((value) => websiteIdentity(value).domain))];
    competitors = confirmedCompetitors(input, z.string().parse(data.brand_name), domains);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(409, 'Confirmed domains must be public domains');
  }
  // Competitors were found by discovery and reviewed by the reader; their
  // websites are not fetched again here, so an unreachable site cannot block
  // project creation. Domains are still validated as public domains above.
  return db.transaction().execute(async (trx) => {
    const row = await discoveryRow(trx, workspaceId, id, true);
    if (replay(row, key)) return completionView(row);
    if (row.status !== cfg.discovery_status_ready)
      throw new ApiError(409, 'Discovery is not ready for completion');
    const now = new Date();
    const sources = Object.fromEntries(
      policy.brand_identity.profile_fields
        .filter((field) => {
          const values: Record<string, unknown> = input.profile;
          const value = values[field];
          return Array.isArray(value) ? value.length > 0 : Boolean(value);
        })
        .map((field) => [
          field,
          {
            origin: 'ai_suggested',
            review_state: 'unreviewed',
            reviewed_by: null,
            reviewed_at: null,
          },
        ]),
    );
    const snapshot = await trx
      .selectFrom('brand_research_snapshots')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('discovery_id', '=', id)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst();
    if (!snapshot) throw new ApiError(409, 'Discovery research evidence is unavailable');
    const artifacts = Object.fromEntries(Object.keys(sources).map((field) => [field, snapshot.id]));
    const brandName = z.string().parse(data.brand_name);
    const aliases = seedBrandAliases(brandName, domains);
    const projectId = await insertProject(
      trx,
      workspaceId,
      null,
      projectCreate.parse({
        ...data,
        name: input.name ?? brandName,
        brand: { aliases },
        country_code: data.primary_market,
        ...input.profile,
        industry: data.industry,
        subindustry: data.subindustry,
        owned_domains: domains,
        competitors,
        business_context: businessContext(input, data),
      }),
      sources,
      artifacts,
    );
    await trx
      .insertInto('prompt_sets')
      .values({
        id: randomUUID(),
        project_id: projectId,
        name: policy.projects.prompt_set_name,
        description: '',
        created_at: now,
        updated_at: now,
      })
      .execute();
    const updated = await trx
      .updateTable('brand_discoveries')
      .set({
        project_id: projectId,
        status: cfg.discovery_status_project_created,
        stage: 'complete',
        domains: JSON.stringify(domains),
        competitors: JSON.stringify(competitors),
        profile: JSON.stringify(input.profile),
        input_data: JSON.stringify({
          ...data,
          completion_idempotency_key: key,
          completion_payload: input,
          completion_reviewer_id: userId,
        }),
        progress: JSON.stringify(
          discoveryProgress('complete', cfg.discovery_progress_total_steps, 0, competitors.length),
        ),
        error_code: '',
        error_detail: '',
        updated_at: now,
      })
      .where('id', '=', id)
      .where('workspace_id', '=', workspaceId)
      .returningAll()
      .executeTakeFirstOrThrow();
    return completionView(updated);
  });
}
