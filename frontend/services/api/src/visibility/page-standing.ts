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

import { policy } from '../config.ts';
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
