/**
 * The marks and websites behind recorded brand names.
 *
 * A mention is persisted as a NAME, resolved against this
 * project's brand and competitor records (every competitor alias included);
 * the tracked brand wins a name collision, and a name that resolves to
 * nothing has no mark rather than a borrowed one.
 */
import { brandLogoUrl, competitorLogoUrl } from '../projects/logos.ts';
import type { Database } from '../db/database.ts';
import { scalarText } from '../text-order.ts';

export type BrandIdentity = { logo_url: string | null; website: string | null };

/**
 * `identity_key`: whitespace-collapsed and lowercased. Lowercasing rather than
 * full case folding differs only for letters such as `ß` and final sigma, and
 * both sides of every lookup here are keyed by this one function.
 */
export function identityKey(name: unknown): string {
  return scalarText(name).trim().replace(/\s+/gu, ' ').toLowerCase();
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** This project's marks keyed by `identityKey`; the project is already authorized. */
export async function brandIdentities(
  db: Database,
  projectId: string,
): Promise<Map<string, BrandIdentity>> {
  const project = await db
    .selectFrom('projects')
    .select(['id', 'website_url'])
    .where('id', '=', projectId)
    .executeTakeFirst();
  const found = new Map<string, BrandIdentity>();
  if (project === undefined) return found;
  const brand = await db
    .selectFrom('brands')
    .select(['name', 'logo_asset_id'])
    .where('project_id', '=', projectId)
    .executeTakeFirst();
  if (brand?.name) {
    found.set(identityKey(brand.name), {
      logo_url: brand.logo_asset_id ? brandLogoUrl(project.id) : null,
      website: project.website_url || null,
    });
  }
  const competitors = await db
    .selectFrom('competitors')
    .select(['id', 'name', 'aliases', 'domains', 'logo_asset_id'])
    .where('project_id', '=', projectId)
    .orderBy('created_at')
    .execute();
  for (const competitor of competitors) {
    const domains = listOf(competitor.domains).filter(Boolean).map(String);
    const identity = {
      logo_url: competitor.logo_asset_id ? competitorLogoUrl(project.id, competitor.id) : null,
      website: domains[0] ?? null,
    };
    for (const name of [competitor.name, ...listOf(competitor.aliases)]) {
      const key = identityKey(name);
      if (name && !found.has(key)) found.set(key, identity);
    }
  }
  return found;
}
