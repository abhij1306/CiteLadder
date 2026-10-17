/**
 * Everything one cited URL's own page shows, from persisted rows only.
 *
 * Keyed by the URL the
 * engines reported, so a citation whose page identity was never resolved
 * still has a page. `brands` is co-occurrence (named in answers that cited
 * this URL), never presence on the page; `first_seen` is the first sighting
 * within the selection, never the page's age.
 */
import type { visibilitySourceUrlSchema } from '@citeladder/contracts/visibility-evidence';
import { sql } from 'kysely';
import type { z } from 'zod';

import type { Database } from '../db/database.ts';
import { latestReadings, pageEntities, readAt, readingPresences } from '../source-pages/reading.ts';
import { wireUtcOrNull, utcText } from '../db/timestamps.ts';
import { brandIdentities, identityKey } from './brand-identities.ts';
import { earnedPageActions, pageStanding } from './page-standing.ts';
import { authorizedSelection, evidenceScope, observedAt, type RunSelection } from './selection.ts';
import { compareText } from '../text-order.ts';

// A detail page shows what a person can take in; its tables do not page.
const SOURCE_URL_MAX_PROMPTS = 50;
const SOURCE_URL_MAX_BRANDS = 12;

export type SourceUrlDetail = z.input<typeof visibilitySourceUrlSchema>;

function scopeOf(db: Database, selection: RunSelection) {
  return evidenceScope(db, selection)
    .select([
      'ra.id as analysis_id',
      'ra.logical_engine as logical_engine',
      'ra.transport_model as transport_model',
      observedAt.as('observed_at'),
      'snapshot.text as prompt_text',
      'snapshot.theme as theme',
      // Coalesced to the frozen text: a deleted prompt's snapshot has a NULL
      // id, and count(distinct) would skip it.
      sql`coalesce(snapshot.prompt_id::text, snapshot.text)`.as('prompt_key'),
    ])
    .as('scope');
}

type Scope = ReturnType<typeof scopeOf>;

function citedOf(db: Database, scope: Scope, workspaceId: string, url: string) {
  return db
    .selectFrom(scope)
    .innerJoin('citations as citation', 'citation.analysis_id', 'scope.analysis_id')
    .where('citation.workspace_id', '=', workspaceId)
    .where('citation.url', '=', url)
    .selectAll('scope')
    .as('cited');
}

type Cited = ReturnType<typeof citedOf>;

async function engines(db: Database, cited: Cited): Promise<SourceUrlDetail['engines']> {
  const rows = await db
    .selectFrom(cited)
    .select([
      'cited.logical_engine',
      'cited.transport_model',
      sql<string>`count(distinct cited.analysis_id)`.as('retrievals'),
    ])
    .groupBy(['cited.logical_engine', 'cited.transport_model'])
    .execute();
  return rows
    .map((row) => ({
      logical_engine: row.logical_engine || '',
      transport_model: row.transport_model,
      retrievals: Number(row.retrievals),
    }))
    .sort(
      (left, right) =>
        right.retrievals - left.retrievals ||
        compareText(left.logical_engine, right.logical_engine) ||
        compareText(left.transport_model ?? '', right.transport_model ?? ''),
    );
}

async function promptRows(db: Database, cited: Cited): Promise<SourceUrlDetail['prompt_rows']> {
  const responses = sql<string>`count(distinct cited.analysis_id)`;
  const rows = await db
    .selectFrom(cited)
    .select([
      'cited.prompt_text',
      'cited.theme',
      responses.as('responses'),
      utcText(sql`max(cited.observed_at)`).as('last_seen'),
      sql<(string | null)[] | null>`array_agg(distinct cited.logical_engine)`.as('engines'),
    ])
    .groupBy(['cited.prompt_text', 'cited.theme'])
    .orderBy(responses, 'desc')
    .limit(SOURCE_URL_MAX_PROMPTS)
    .execute();
  return rows.map((row) => ({
    prompt_text: row.prompt_text || '',
    topic: row.theme || null,
    responses: Number(row.responses),
    last_seen: wireUtcOrNull(row.last_seen),
    engines: (row.engines ?? [])
      .filter((engine): engine is string => Boolean(engine))
      .sort(compareText),
  }));
}

/** Names recorded in the cited answers, with the answers that named each. */
async function mentionCounts(
  db: Database,
  workspaceId: string,
  cited: Cited,
  kind: 'brand' | 'competitor',
): Promise<{ name: string; responses: number }[]> {
  const rows =
    kind === 'brand'
      ? await db
          .selectFrom('brand_mentions as mention')
          .innerJoin(cited, 'cited.analysis_id', 'mention.analysis_id')
          .where('mention.workspace_id', '=', workspaceId)
          .where('mention.brand_name', '!=', '')
          .select([
            'mention.brand_name as name',
            sql<string>`count(distinct mention.analysis_id)`.as('responses'),
          ])
          .groupBy('mention.brand_name')
          .execute()
      : await db
          .selectFrom('competitor_mentions as mention')
          .innerJoin(cited, 'cited.analysis_id', 'mention.analysis_id')
          .where('mention.workspace_id', '=', workspaceId)
          .where('mention.competitor_name', '!=', '')
          .select([
            'mention.competitor_name as name',
            sql<string>`count(distinct mention.analysis_id)`.as('responses'),
          ])
          .groupBy('mention.competitor_name')
          .execute();
  return rows.map((row) => ({ name: row.name, responses: Number(row.responses) }));
}

/**
 * Brands and competitors named in the answers that cited this URL: the
 * strongest link the rows support, since a mention is recorded against the
 * response, never against the citation beside it.
 */
async function brands(
  db: Database,
  selection: RunSelection,
  cited: Cited,
): Promise<SourceUrlDetail['brands']> {
  const found: { kind: 'brand' | 'competitor'; name: string; responses: number }[] = [];
  for (const kind of ['brand', 'competitor'] as const) {
    for (const row of await mentionCounts(db, selection.workspaceId, cited, kind)) {
      if (row.name) found.push({ kind, ...row });
    }
  }
  const ordered = found
    .toSorted(
      (left, right) => right.responses - left.responses || compareText(left.name, right.name),
    )
    .slice(0, SOURCE_URL_MAX_BRANDS);
  const identities = await brandIdentities(db, selection.projectId);
  return ordered.map((entry) => {
    const identity = identities.get(identityKey(entry.name));
    return { ...entry, logo_url: identity?.logo_url ?? null, website: identity?.website ?? null };
  });
}

/**
 * What this project knows about the page itself: whether and when it was
 * read, what kind of page it is and how that was established, who is named on
 * it with the quoted line, and the open Action to get listed on it.
 *
 * Presence comes from the latest SUCCESSFUL reading only, so a later failed
 * attempt never erases what was learned, and a page nobody read carries no
 * verdicts at all. One bounded read by page identity; it never fetches.
 */
async function pageSection(
  db: Database,
  selection: RunSelection,
  urlHash: string | null | undefined,
): Promise<SourceUrlDetail['page']> {
  if (!urlHash) return null;
  const page = await db
    .selectFrom('source_pages')
    .select([
      'id',
      'url_hash',
      'inspection_state',
      'inspection_reason',
      'page_format',
      'page_format_method',
      'source_class',
    ])
    .where('workspace_id', '=', selection.workspaceId)
    .where('project_id', '=', selection.projectId)
    .where('url_hash', '=', urlHash)
    .executeTakeFirst();
  if (!page) return null;
  const scope = { workspaceId: selection.workspaceId, projectId: selection.projectId };
  const reading = (await latestReadings(db, scope, [page.id])).get(page.id);
  const presences = reading
    ? ((await readingPresences(db, scope, [reading.id])).get(reading.id) ?? [])
    : [];
  const actionId = (await earnedPageActions(db, selection, [page.url_hash])).get(page.url_hash);
  return {
    state: page.inspection_state,
    reason: page.inspection_reason,
    read_at: reading ? readAt(reading) : null,
    extracted_chars: reading?.extracted_chars ?? null,
    page_format: page.page_format,
    page_format_method: page.page_format_method,
    source_class: page.source_class,
    entities: reading ? pageEntities(reading, presences) : [],
    standing: pageStanding(page, reading, presences),
    action_id: actionId ?? null,
  };
}

export async function getSourceUrlDetail(
  db: Database,
  requested: RunSelection,
  url: string,
): Promise<SourceUrlDetail> {
  const selection = await authorizedSelection(db, requested);
  const scope = scopeOf(db, selection);
  const denominator = await db
    .selectFrom(scope)
    .select(sql<string>`count(distinct scope.analysis_id)`.as('responses'))
    .executeTakeFirstOrThrow();
  const cited = citedOf(db, scope, selection.workspaceId, url);
  const overview = await db
    .selectFrom(cited)
    .select([
      sql<string>`count(distinct cited.analysis_id)`.as('retrievals'),
      utcText(sql`min(cited.observed_at)`).as('first_seen'),
      utcText(sql`max(cited.observed_at)`).as('last_seen'),
      sql<string>`count(distinct cited.prompt_key)`.as('prompts'),
    ])
    .executeTakeFirstOrThrow();
  const matching = db
    .selectFrom('citations as citation')
    .innerJoin(scope, 'scope.analysis_id', 'citation.analysis_id')
    .where('citation.workspace_id', '=', selection.workspaceId)
    .where('citation.url', '=', url);
  // The page identity these citations resolved to rides on the count.
  const { citations, url_hash: urlHash } = await matching
    .select([
      sql<string>`count(citation.id)`.as('citations'),
      sql<string | null>`max(citation.url_hash)`.as('url_hash'),
    ])
    .executeTakeFirstOrThrow();
  // The title the engines reported, most recent non-empty first.
  const title = await matching
    .where('citation.title', '!=', '')
    .select('citation.title')
    .orderBy('scope.observed_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  const retrievals = Number(overview.retrievals);
  return {
    url,
    title: title?.title ?? '',
    retrievals,
    citations: Number(citations),
    responses: Number(denominator.responses),
    // Per response the URL was RETRIEVED in, as the URL table's column is.
    citation_rate: retrievals ? Number(citations) / retrievals : null,
    prompts: Number(overview.prompts),
    first_seen: wireUtcOrNull(overview.first_seen),
    last_seen: wireUtcOrNull(overview.last_seen),
    engines: await engines(db, cited),
    prompt_rows: await promptRows(db, cited),
    brands: await brands(db, selection, cited),
    page: await pageSection(db, selection, urlHash),
  };
}
