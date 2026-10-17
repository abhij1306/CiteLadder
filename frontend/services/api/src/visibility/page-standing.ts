/**
 * Where the business stands on cited pages, and the Action to get listed.
 *
 * Shared by the Sources URL table (per row, and its `gap` filter) and one
 * URL's own page. Standing comes from the latest SUCCESSFUL reading only, so
 * a later failed attempt never erases what was learned, and a page nobody read
 * carries no verdict. Reads persisted rows only; nothing here fetches.
 */
import type { pageStandingSchema } from '@citeladder/contracts/visibility-evidence';
import { sql } from 'kysely';
import type { z } from 'zod';

import { earnedTargetKey } from '../analysis/opportunities/earned-pages.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import type { Reading, ReadingPresence } from '../source-pages/reading.ts';
import type { RunSelection } from './selection.ts';

export type PageStanding = z.infer<typeof pageStandingSchema>;

const s = policy.opportunity.source_pages;
const classes = policy.opportunity.source_patterns;
// Pages that belong to the business or a competitor can never list the business.
const OWN_PAGE_CLASSES = policy.opportunity.earned_actions.EARNED_EXCLUDED_SOURCE_CLASSES;
const INSPECTED = policy.opportunity.refresh.source_page_outcome_inspected;

/**
 * One page's standing. A page that belongs to the business or to a
 * competitor can never list it, so it is named as such rather than judged.
 */
export function pageStanding(
  page: { source_class: string | null; inspection_state: string },
  reading: Reading | undefined,
  presences: readonly ReadingPresence[],
): PageStanding {
  if (page.source_class === classes.SOURCE_CLASS_BRAND_OWNED) return 'yours';
  if (page.source_class === classes.SOURCE_CLASS_COMPETITOR_OWNED) return 'competitor';
  if (!reading) {
    if (page.inspection_state === s.INSPECTION_BLOCKED) return 'blocked';
    return page.inspection_state === s.INSPECTION_FAILED ? 'unreadable' : 'not_read';
  }
  const brand = presences.find((row) => row.entity_kind === s.ENTITY_KIND_BRAND);
  if (brand?.presence === s.PRESENCE_PRESENT) return 'listed';
  const competitorListed = presences.some(
    (row) => row.entity_kind !== s.ENTITY_KIND_BRAND && row.presence === s.PRESENCE_PRESENT,
  );
  return competitorListed && brand?.presence === s.PRESENCE_NOT_DETECTED ? 'gap' : 'read';
}

/**
 * The url hashes of this project's `gap` pages, as an uncorrelated SQL
 * subquery: the same rule as `pageStanding`, so the filter pages through
 * exactly the rows that show the gap standing. Evaluated once per read, not
 * once per citation.
 */
export function gapPageHashes(selection: RunSelection) {
  return sql<string>`
    select gap_page.url_hash
    from source_pages gap_page
    cross join lateral (
      select reading.id
      from source_page_snapshots reading
      where reading.source_page_id = gap_page.id
        and reading.workspace_id = ${selection.workspaceId}
        and reading.project_id = ${selection.projectId}
        and reading.outcome = ${INSPECTED}
      order by reading.fetched_at desc, reading.id desc
      limit 1
    ) latest
    where gap_page.workspace_id = ${selection.workspaceId}
      and gap_page.project_id = ${selection.projectId}
      and coalesce(gap_page.source_class, '') not in (${sql.join([...OWN_PAGE_CLASSES])})
      and exists (
        select 1 from source_page_entity_presences brand
        where brand.snapshot_id = latest.id
          and brand.workspace_id = ${selection.workspaceId}
          and brand.entity_kind = ${s.ENTITY_KIND_BRAND}
          and brand.presence = ${s.PRESENCE_NOT_DETECTED}
      )
      and exists (
        select 1 from source_page_entity_presences rival
        where rival.snapshot_id = latest.id
          and rival.workspace_id = ${selection.workspaceId}
          and rival.entity_kind <> ${s.ENTITY_KIND_BRAND}
          and rival.presence = ${s.PRESENCE_PRESENT}
      )`;
}

/**
 * The Action to get listed on each page, by url hash: the one grouping the
 * page's live earned Opportunity, highest priority first should there be two.
 */
export async function earnedPageActions(
  db: Database,
  selection: RunSelection,
  urlHashes: readonly string[],
): Promise<Map<string, string>> {
  const actions = new Map<string, string>();
  if (!urlHashes.length) return actions;
  const targets = new Map(urlHashes.map((hash) => [earnedTargetKey(hash), hash]));
  const rows = await db
    .selectFrom('opportunities as opportunity')
    .innerJoin('actions as action', (join) =>
      join
        .onRef('action.project_id', '=', 'opportunity.project_id')
        .on(sql<boolean>`action.member_opportunity_ids @> jsonb_build_array(opportunity.id::text)`),
    )
    .distinctOn('opportunity.target_key')
    .select(['opportunity.target_key', 'action.id'])
    .where('opportunity.workspace_id', '=', selection.workspaceId)
    .where('opportunity.project_id', '=', selection.projectId)
    .where('opportunity.target_key', 'in', [...targets.keys()])
    .where('opportunity.superseded_at', 'is', null)
    .where('action.workspace_id', '=', selection.workspaceId)
    .orderBy('opportunity.target_key')
    .orderBy(sql`opportunity.priority_score desc nulls last`)
    .execute();
  for (const row of rows) {
    const hash = targets.get(row.target_key);
    if (hash) actions.set(hash, row.id);
  }
  return actions;
}
