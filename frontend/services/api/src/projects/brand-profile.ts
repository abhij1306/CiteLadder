/**
 * The brand profile: a project's reviewed brand knowledge.
 *
 * Onboarding creates the profile and prompt generation records
 * business-map suggestions in its `business_context`; people edit the four
 * knowledge fields, the identity facets (category, buyer type, market scope,
 * business model) and the business-context lists onboarding resolved (service
 * areas, buyer roles, category terms, jobs to be done) here. Every TypeScript
 * writer takes the project advisory
 * lock before the profile row, shared with generation.
 */
import { randomUUID } from 'node:crypto';

import {
  brandProfileReviewStateSchema,
  brandProfileSchema,
  brandProfileSourceSchema,
  businessModelSchema,
  buyerTypeSchema,
  marketScopeSchema,
} from '@citeladder/contracts/project';
import type { Selectable } from 'kysely';
import { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { jsonObject } from '../db/json.ts';
import type { BrandProfiles } from '../generated/db-schema.ts';
import { acquireProjectLock } from '../prompts/locks.ts';
import { notFound } from '../errors.ts';
import { categoryInput } from './inputs.ts';

export type ProjectScope = { workspaceId: string; projectId: string };
type BrandProfile = z.input<typeof brandProfileSchema>;
type ProfileRow = Selectable<BrandProfiles>;

const {
  profile_fields: FIELDS,
  profile_text_max_chars: TEXT_MAX,
  profile_product_max_chars: PRODUCT_MAX,
  profile_products_max_count: PRODUCTS_MAX,
} = policy.brand_identity;
const SOURCE_MANUAL = brandProfileSourceSchema.parse(policy.brand_identity.profile_source_manual);
const REVIEW_CONFIRMED = brandProfileReviewStateSchema.parse(
  policy.brand_identity.profile_review_confirmed,
);
const REVIEW_EDITED = brandProfileReviewStateSchema.parse(
  policy.brand_identity.profile_review_edited,
);

type Field = keyof z.infer<typeof brandProfileSchema.shape.sources>;

const text = z.string().max(TEXT_MAX).nullish();

/** One business-context list: short phrases, one per entry; an empty list clears it. */
const contextList = z
  .array(z.string().trim().min(1).max(policy.brand_identity.map_value_max_chars))
  .max(policy.brand_identity.context_list_max_entries)
  .nullish();

/** A partial edit: an absent or null field is left untouched. */
export const brandProfileUpdate = z.object({
  description: text,
  positioning: text,
  products_services: z.array(z.string().max(PRODUCT_MAX)).max(PRODUCTS_MAX).nullish(),
  target_audience: text,
  category: categoryInput.nullish(),
  buyer_type: buyerTypeSchema.nullish(),
  market_scope: marketScopeSchema.nullish(),
  business_model: businessModelSchema.nullish(),
  service_areas: contextList,
  buyer_roles: contextList,
  category_terms: contextList,
  jobs_to_be_done: contextList,
});
const IDENTITY_FACETS = ['category', 'buyer_type', 'market_scope', 'business_model'] as const;
/** Business-context lists onboarding resolved, editable here as reviewed facts. */
const CONTEXT_LISTS = [
  'service_areas',
  'buyer_roles',
  'category_terms',
  'jobs_to_be_done',
] as const;
// Inferred from the onboarding category; they describe a replaced category.
const CATEGORY_DERIVED = ['category_terms', 'category_aliases', 'category_options'] as const;
export type BrandProfileUpdate = z.infer<typeof brandProfileUpdate>;

const contractProvenance = brandProfileSchema.shape.sources.shape.description.unwrap();
// Rows written before the onboarding writer carried the reviewer keys store
// provenance entries without them; absent there means no reviewer and no
// review time, so null is their truthful reading, not a fabricated one.
const storedProvenance = contractProvenance.extend({
  reviewed_by: contractProvenance.shape.reviewed_by.default(null),
  reviewed_at: contractProvenance.shape.reviewed_at.default(null),
});
const storedSources = z.record(z.string(), storedProvenance);
// Review times are stored as ISO text; the view renders them as ISO instants.
const viewedSources = z.record(
  z.string(),
  storedProvenance.transform((entry) => ({
    ...entry,
    reviewed_at: entry.reviewed_at === null ? null : new Date(entry.reviewed_at).toISOString(),
  })),
);
const storedArtifacts = z.record(z.string(), z.uuid());
const storedProducts = z.array(z.string());

/** Trim, drop blanks and case-insensitive duplicates (first spelling wins). */
function cleanProducts(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const value of values) {
    const item = value.trim();
    const key = item.toLowerCase();
    if (item && !seen.has(key)) {
      seen.add(key);
      cleaned.push(item);
    }
  }
  return cleaned;
}

export function profileProducts(row: ProfileRow): string[] {
  return storedProducts.parse(row.products_services);
}

function byField<T>(stored: Record<string, T>): Record<Field, T | null> {
  return Object.fromEntries(FIELDS.map((field) => [field, stored[field] ?? null])) as Record<
    Field,
    T | null
  >;
}

/**
 * Older contexts name the buyer facet `business_type`. Fold it into
 * `buyer_type` (a reviewed `business_type` value wins over an unreviewed current one) so
 * every reader and writer sees one key.
 */
function withBuyerType(stored: Record<string, unknown>): Record<string, unknown> {
  if (!('business_type' in stored)) return stored;
  const { business_type: older, ...business } = stored;
  const { business_type: olderSource, ...sources } = jsonObject(
    stored.field_sources ?? {},
    'business_context.field_sources',
  );
  if (
    !('buyer_type' in business) ||
    (olderSource === 'reviewed' && sources.buyer_type !== 'reviewed')
  ) {
    business.buyer_type = older;
    if (olderSource !== undefined) sources.buyer_type = olderSource;
  }
  return { ...business, field_sources: sources };
}

function view(row: ProfileRow): BrandProfile {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    project_id: row.project_id,
    brand_id: row.brand_id,
    description: row.description,
    positioning: row.positioning,
    products_services: profileProducts(row),
    target_audience: row.target_audience,
    business_context: withBuyerType(
      jsonObject(row.business_context, 'brand_profiles.business_context'),
    ),
    sources: byField(viewedSources.parse(row.sources)),
    source_artifact_ids: byField(storedArtifacts.parse(row.source_artifact_ids)),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/** The project's profile row, locked when `forUpdate`, or 404. */
export async function loadProfile(
  db: Database,
  scope: ProjectScope,
  forUpdate = false,
): Promise<ProfileRow> {
  let query = db
    .selectFrom('brand_profiles')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId);
  if (forUpdate) query = query.forUpdate();
  const row = await query.executeTakeFirst();
  if (row === undefined) throw notFound('Brand profile');
  return row;
}

export async function readBrandProfile(db: Database, scope: ProjectScope): Promise<BrandProfile> {
  return view(await loadProfile(db, scope));
}
/** Optional grounding projection; missing memory stays unavailable and provenance stays attached. */
export async function readBrandMemory(db: Database, scope: ProjectScope) {
  const row = await db
    .selectFrom('brand_profiles')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .executeTakeFirst();
  if (!row) return null;
  const profile = view(row);
  const { business_map: _map, ...business } = profile.business_context;
  const sources = jsonObject(business.field_sources ?? {}, 'business_context.field_sources');
  return { ...profile, business_context: { ...business, field_sources: sources } };
}

type StoredSources = z.infer<typeof storedSources>;
type StoredArtifacts = z.infer<typeof storedArtifacts>;

/** Writes each supplied field's value and reviewed provenance; mutates `sources` and `artifacts`. */
function applyFieldEdits(
  update: BrandProfileUpdate,
  sources: StoredSources,
  artifacts: StoredArtifacts,
  userId: string,
  now: Date,
) {
  const values: Partial<Record<Field, string>> = {};
  for (const field of FIELDS as readonly Field[]) {
    const value = update[field];
    if (value === null || value === undefined) continue;
    values[field] = typeof value === 'string' ? value.trim() : JSON.stringify(cleanProducts(value));
    const prior = sources[field];
    sources[field] = {
      origin: prior?.origin ?? SOURCE_MANUAL,
      review_state: prior ? REVIEW_EDITED : REVIEW_CONFIRMED,
      reviewed_by: userId,
      reviewed_at: now.toISOString(),
    };
    delete artifacts[field];
  }
  return values;
}

type ContextField = (typeof IDENTITY_FACETS)[number] | (typeof CONTEXT_LISTS)[number];

/** The supplied identity facets and business-context lists, in the order they apply. */
const contextEdits = (update: BrandProfileUpdate): ContextField[] =>
  [...IDENTITY_FACETS, ...CONTEXT_LISTS].filter((field) => update[field] != null);

/**
 * Records reviewed identity facets and business-context lists in `context`.
 * A changed category drops what derived from it, before any supplied list
 * (such as new category terms) is written.
 */
function applyContextEdits(
  context: Record<string, unknown>,
  update: BrandProfileUpdate,
  fields: readonly ContextField[],
) {
  const fieldSources: Record<string, unknown> = {
    ...jsonObject(context.field_sources ?? {}, 'business_context.field_sources'),
  };
  if (update.category != null && update.category !== context.category)
    for (const derived of CATEGORY_DERIVED) {
      delete context[derived];
      delete fieldSources[derived];
    }
  for (const field of fields) {
    const value = update[field];
    context[field] = Array.isArray(value) ? cleanProducts(value) : value;
    fieldSources[field] = 'reviewed';
  }
  context.field_sources = fieldSources;
}

/**
 * Apply a person's edits. Each supplied field keeps its original origin, is
 * confirmed (first review) or edited (a later one) by this reviewer, and
 * drops the suggestion artifact it no longer matches.
 */
export function updateBrandProfile(
  db: Database,
  scope: ProjectScope,
  userId: string,
  update: BrandProfileUpdate,
): Promise<BrandProfile> {
  return db.transaction().execute(async (trx) => {
    await acquireProjectLock(trx, scope.projectId);
    const brand = await trx
      .selectFrom('brands')
      .select('id')
      .where('project_id', '=', scope.projectId)
      .executeTakeFirst();
    if (brand === undefined) throw notFound('Brand profile');
    const now = new Date();
    await trx
      .insertInto('brand_profiles')
      .values({
        id: randomUUID(),
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        brand_id: brand.id,
        description: '',
        positioning: '',
        products_services: JSON.stringify([]),
        target_audience: '',
        business_context: JSON.stringify({}),
        sources: JSON.stringify({}),
        source_artifact_ids: JSON.stringify({}),
        created_at: now,
        updated_at: now,
      })
      .onConflict((conflict) => conflict.column('project_id').doNothing())
      .execute();
    const row = await loadProfile(trx, scope, true);
    const sources = storedSources.parse(row.sources);
    const artifacts = storedArtifacts.parse(row.source_artifact_ids);
    const values = applyFieldEdits(update, sources, artifacts, userId, now);
    const context = withBuyerType(
      jsonObject(row.business_context, 'brand_profiles.business_context'),
    );
    const fields = contextEdits(update);
    if (fields.length) applyContextEdits(context, update, fields);
    const updated = await trx
      .updateTable('brand_profiles')
      .set({
        ...values,
        ...(fields.length ? { business_context: JSON.stringify(context) } : {}),
        sources: JSON.stringify(sources),
        source_artifact_ids: JSON.stringify(artifacts),
        updated_at: now,
      })
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return view(updated);
  });
}
