import type { pageStandingSchema } from '@citeladder/contracts/visibility-evidence';
import { sql } from 'kysely';
import type { z } from 'zod';

import { policy } from '../config.ts';
import { record } from '../db/json.ts';
import { isListingGap } from '../analysis/listing-gap.ts';
import type { Database } from '../db/database.ts';
import type { ProjectScope } from '../projects/brand-profile.ts';
import {
  judgedUnderCurrentRoster,
  latestReadings,
  readingPresences,
  type Reading,
  type ReadingPresence,
} from '../source-pages/reading.ts';
import { scalarText } from '../text-order.ts';
import type { RunSelection } from './selection.ts';

export type PageStanding = z.infer<typeof pageStandingSchema>;

const s = policy.opportunity.source_pages;
const classes = policy.opportunity.source_patterns;
const earned = policy.opportunity.earned_actions;
const OWN_PAGE_CLASSES = earned.EARNED_EXCLUDED_SOURCE_CLASSES;
const INSPECTED = s.INSPECTION_INSPECTED;

export function pageStanding(
  page: { source_class: string | null; registrable_domain: string; inspection_state: string },
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
  if (brand?.presence === s.PRESENCE_NOT_ASSESSABLE) return 'not_assessable';
  const title = scalarText(record(reading.page_facts).title);
  return isListingGap({ ...page, title }, presences) ? 'gap' : 'read';
}

export async function pageStandings(db: Database, scope: ProjectScope, hashes: readonly string[]) {
  const pages = await db
    .selectFrom('source_pages as page')
    .leftJoin('source_page_snapshots as snapshot', (join) =>
      join
        .onRef('snapshot.id', '=', 'page.latest_snapshot_id')
        .onRef('snapshot.workspace_id', '=', 'page.workspace_id'),
    )
    .select([
      'page.id',
      'page.url_hash',
      'page.source_class',
      'page.registrable_domain',
      'page.inspection_state',
      'page.page_format',
      'page.page_format_method',
      'snapshot.page_facts',
    ])
    .where('page.workspace_id', '=', scope.workspaceId)
    .where('page.project_id', '=', scope.projectId)
    .where('page.url_hash', 'in', hashes)
    .orderBy('page.url_hash')
    .execute();
  const readings = await latestReadings(db, scope, [...new Set(pages.map((page) => page.id))]);
  const presences = await readingPresences(
    db,
    scope,
    [...readings.values()].map((reading) => reading.id),
  );
  const byHash = new Map<string, (typeof pages)[number] & { standing: PageStanding }>();
  for (const page of pages) {
    if (byHash.has(page.url_hash)) continue;
    const reading = readings.get(page.id);
    const standing = pageStanding(page, reading, reading ? (presences.get(reading.id) ?? []) : []);
    byHash.set(page.url_hash, { ...page, standing });
  }
  return byHash;
}

export function gapPageHashes(selection: RunSelection) {
  const scope = { workspaceId: selection.workspaceId, projectId: selection.projectId };
  return sql<string>`
    select gap_page.url_hash
    from source_pages gap_page
    cross join lateral (
      select reading.id, reading.page_facts
      from source_page_snapshots reading
      where reading.source_page_id = gap_page.id
        and reading.workspace_id = ${selection.workspaceId}
        and reading.project_id = ${selection.projectId}
        and reading.outcome = ${INSPECTED}
        and ${judgedUnderCurrentRoster(scope, sql.ref('reading.id'))}
      order by reading.fetched_at desc, reading.id desc
      limit 1
    ) latest
    where gap_page.workspace_id = ${selection.workspaceId}
      and gap_page.project_id = ${selection.projectId}
      and coalesce(gap_page.source_class, '') not in (${sql.join([...OWN_PAGE_CLASSES])})
      and not exists (
        select 1 from unnest(${[...earned.EARNED_EXCLUDED_DOMAINS]}::text[]) excluded(domain)
        where gap_page.registrable_domain = excluded.domain
          or gap_page.registrable_domain like '%.' || excluded.domain
      )
      and not exists (
        select 1 from source_page_entity_presences subject
        where subject.snapshot_id = latest.id
          and subject.workspace_id = ${selection.workspaceId}
          and subject.entity_kind <> ${s.ENTITY_KIND_BRAND}
          and subject.presence = ${s.PRESENCE_PRESENT}
          and lower(btrim(subject.entity_name)) = lower(btrim(regexp_replace(
            coalesce(latest.page_facts ->> 'title', ''), ${earned.EARNED_TITLE_SITE_SUFFIX}, ''
          )))
      )
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
