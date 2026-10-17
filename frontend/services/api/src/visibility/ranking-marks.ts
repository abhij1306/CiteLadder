/**
 * The cached logo and website behind each ranked brand and competitor.
 *
 * A ranking row is matched by its exact recorded name and whether it is the
 * brand: the aggregate stores display names, and a row whose name matches no
 * record carries no mark rather than a borrowed one.
 */
import { normalizeDomain } from '../analysis/domains.ts';
import type { Database } from '../db/database.ts';
import { strings } from '../db/json.ts';
import { brandLogoUrl, competitorLogoUrl } from '../projects/logos.ts';

type Mark = { logo_url: string | null; website_url: string | null };
type Markable = {
  name: string;
  is_brand: boolean;
  logo_url?: string | null;
  website_url?: string | null;
};

function website(value: string | undefined): string | null {
  const domain = normalizeDomain(value);
  return domain ? `https://${domain}` : null;
}

const markKey = (isBrand: boolean, name: string) => `${isBrand ? 'brand' : 'competitor'}:${name}`;

/** Marks for this already-authorized project, keyed by kind and exact name. */
export async function rankingMarks(db: Database, projectId: string): Promise<Map<string, Mark>> {
  const marks = new Map<string, Mark>();
  const project = await db
    .selectFrom('projects')
    .select(['id', 'website_url'])
    .where('id', '=', projectId)
    .executeTakeFirst();
  if (project === undefined) return marks;
  const brand = await db
    .selectFrom('brands')
    .select(['name', 'logo_asset_id'])
    .where('project_id', '=', projectId)
    .executeTakeFirst();
  if (brand !== undefined) {
    const owned = await db
      .selectFrom('owned_domains')
      .select('domain')
      .where('project_id', '=', projectId)
      .where('domain', '!=', '')
      .orderBy('created_at')
      .limit(1)
      .executeTakeFirst();
    marks.set(markKey(true, brand.name), {
      logo_url: brand.logo_asset_id ? brandLogoUrl(project.id) : null,
      website_url: website(project.website_url || owned?.domain),
    });
  }
  const competitors = await db
    .selectFrom('competitors')
    .select(['id', 'name', 'domains', 'logo_asset_id'])
    .where('project_id', '=', projectId)
    .orderBy('created_at')
    .execute();
  for (const competitor of competitors) {
    marks.set(markKey(false, competitor.name), {
      logo_url: competitor.logo_asset_id ? competitorLogoUrl(project.id, competitor.id) : null,
      website_url: website(strings(competitor.domains).find(Boolean)),
    });
  }
  return marks;
}

/** Set each row's logo and website from `marks`, in place. */
export function applyMarks(rows: readonly Markable[], marks: ReadonlyMap<string, Mark>): void {
  for (const row of rows) {
    const mark = marks.get(markKey(row.is_brand, row.name));
    row.logo_url = mark?.logo_url ?? null;
    row.website_url = mark?.website_url ?? null;
  }
}
