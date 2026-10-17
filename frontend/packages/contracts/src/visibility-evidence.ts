import { z } from 'zod';
import { citationSchema } from './audits.ts';
import { pageEntitySchema } from './source-pages.ts';

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);
const uuid = () => z.uuid();

// ---------------------------------------------------------------------------
// Execution-evidence projection (Query fanouts, and the Sources drill-downs)
// `GET /projects/{id}/visibility/evidence`. A pure read projection over already
// persisted mention/citation/task/artifact rows — nothing is inferred or
// backfilled at read time.
// ---------------------------------------------------------------------------

// Three-state query-fanout availability for one execution (backend
// `VisibilityFanoutState`): `queries_available` (≥1 stored event has non-blank
// query text), `count_only` (search used / count positive but no query text —
// e.g. a count-only row), `no_search` (neither signal present).
const visibilityFanoutStateSchema = z.enum([
  'queries_available',
  'count_only',
  'no_search',
  'unavailable',
  'no_exposed_queries',
]);

// One normalized stored search event (backend `VisibilityEvidenceSearchEvent`).
// Empty query strings are preserved verbatim (a count-only event); query text
// is never invented.
const visibilityEvidenceSearchEventSchema = responseObject({
  sequence: z.number().int(),
  query: z.string(),
  call_id: z.string(),
  call_sequence: z.number().int(),
  query_sequence: z.number().int(),
});

// One persisted brand/competitor mention row (backend
// `VisibilityMentionEvidence`). Projected directly from `BrandMention` /
// `CompetitorMention`; never inferred from answer text at read time.
const visibilityMentionEvidenceSchema = responseObject({
  kind: z.enum(['brand', 'competitor']),
  name: z.string(),
  first_offset: z.number().int().nullable(),
  artifact_id: uuid().nullable(),
  analyzer_version: z.string(),
});

// One execution's persisted mention/citation + query-fanout evidence (backend
// `VisibilityExecutionEvidence`). `prompt_id` is nullable so a deleted source
// prompt stays readable via its frozen `prompt_text`; `completed_at` is
// nullable for an incomplete row.
export const visibilityExecutionEvidenceSchema = responseObject({
  audit_id: uuid(),
  task_id: uuid(),
  analysis_id: uuid(),
  artifact_id: uuid().nullable(),
  prompt_snapshot_id: uuid(),
  prompt_id: uuid().nullable(),
  prompt_index: z.number().int(),
  prompt_text: z.string(),
  repetition: z.number().int(),
  completed_at: z.string().nullable(),
  logical_engine: z.string(),
  transport_provider: z.string(),
  transport_model: z.string(),
  // Execution-level surface (singular model).
  retrieval_enabled: z.boolean().nullable().default(null),
  search_used: z.boolean(),
  search_query_count: z.number().int(),
  query_text_available: z.boolean(),
  state: visibilityFanoutStateSchema,
  search_events: z.array(visibilityEvidenceSearchEventSchema),
  event_source: z.enum(['raw_artifact', 'audit_task', 'none']),
  mentions: z.array(visibilityMentionEvidenceSchema),
  citations: z.array(citationSchema),
});

// The shared evidence dataset for the two evidence tabs (backend
// `VisibilityEvidenceResponse`). `items` is newest-first; `truncated` is set
// when more than `limit` matches exist (no offset/cursor/total).
export const visibilityEvidenceResponseSchema = responseObject({
  items: z.array(visibilityExecutionEvidenceSchema),
  truncated: z.boolean(),
  total: z.number().int().optional(),
  next_cursor: z.string().nullable().optional(),
  as_of: z.string().nullable().optional(),
  prompt_options: z.array(responseObject({ id: uuid(), label: z.string() })).optional(),
});

/**
 * Where the business stands on one cited page, from its latest successful
 * reading: its own or a competitor's page, not read yet (and why), a `gap`
 * (competitors listed and the business not), listed, or read with neither.
 */
export const pageStandingSchema = z.enum([
  'yours',
  'competitor',
  'blocked',
  'unreadable',
  'not_read',
  'gap',
  'listed',
  'read',
]);

export const visibilitySourcesSchema = responseObject({
  previous_cursor: z.string().nullable().optional(),
  total: z.number().int(),
  responses: z.number().int(),
  prompts: z.number().int(),
  // Every citation in the filtered selection: the denominator behind
  // `citation_share` and the number the source-type ring reports in its centre.
  total_citations: z.number().int(),
  // Citations per source class across the WHOLE selection, so the breakdown is
  // not a picture of whichever page happens to be loaded.
  category_totals: z.record(z.string(), z.number().int()).optional(),
  next_cursor: z.string().nullable(),
  as_of: z.string(),
  comparison_status: z.string(),
  // Answers whose surface exposed what it read, and the engines in the
  // selection that expose none: their reads are unknown, never zero.
  retrieval: responseObject({
    responses: z.number().int(),
    unavailable_engines: z.array(z.string()),
  }),
  items: z.array(
    responseObject({
      key: z.string(),
      // Answers that read this source, cited or not; null when no answer in
      // the selection exposes what it read.
      retrieved: z.number().int().nullable(),
      responses: z.number().int(),
      prompts: z.number().int(),
      annotations: z.number().int(),
      urls: z.number().int(),
      response_rate: z.number().nullable(),
      prompt_coverage: z.number().nullable(),
      // Unique URLs from this source per response, this row's share of the
      // filtered view's citations, and citations per response the source was
      // RETRIEVED in — never per response in the selection.
      retrieval_rate: z.number().nullable(),
      citation_share: z.number().nullable(),
      citation_rate: z.number().nullable(),
      ownership: z.array(z.string()),
      categories: z.array(z.string()),
      taxonomy_versions: z.array(z.string()),
      category_unavailable: z.boolean(),
      response_delta: z.number().nullable(),
      // Page rows only, and three distinct answers. `url_hash` is the page
      // identity the citation resolved to; `inspection_state` is null until
      // this project has a record of that page; `opportunity_id` is set once
      // a qualified rule has acted on it. A domain row carries none of them.
      url_hash: z.string().nullable(),
      inspection_state: z.string().nullable(),
      opportunity_id: uuid().nullable(),
      // Also page rows only: the page's standing (null until this project has
      // a record of the page) and the Action to get listed on it, if any.
      standing: pageStandingSchema.nullable(),
      action_id: uuid().nullable(),
      // Page facts, for the URL table. `page_format_method` says how the kind
      // was established, so a format read off the address alone is never
      // presented as one read off the page.
      title: z.string().nullable(),
      page_format: z.string().nullable(),
      page_format_method: z.string().nullable(),
      last_cited_at: z.string().nullable(),
      // Brands named in the ANSWERS that cited this page, never found on it.
      // `mentions` is the distinct count; `brands` is the leading few.
      mentions: z.number().int(),
      brands: z.array(
        responseObject({
          kind: z.enum(['brand', 'competitor']),
          name: z.string(),
          responses: z.number().int(),
          // The cached mark this project holds, or a site to derive one from.
          logo_url: z.string().nullable(),
          website: z.string().nullable(),
        }),
      ),
    }),
  ),
});

/**
 * The leading sources' use over the selected period, one dense line each.
 *
 * Every series carries a point for every bucket, including the buckets where
 * it was cited nothing at all: a sparse series would let a line skip a gap and
 * read as continuous use.
 */
export const visibilitySourceSeriesSchema = responseObject({
  dimension: z.enum(['domain', 'url']),
  granularity: z.string(),
  buckets: z.array(z.string()),
  series: z.array(
    responseObject({
      key: z.string(),
      citations: z.number().int(),
      points: z.array(
        responseObject({
          at: z.string(),
          responses: z.number().int(),
          // Null only when the bucket held no responses at all, which is not
          // the same fact as a source going uncited in a bucket that did.
          share: z.number().nullable(),
        }),
      ),
    }),
  ),
});

/**
 * The project's own pages an engine read but did not cite in the same answer.
 * Only answers whose surface exposes what it read count; `responses` is that
 * denominator.
 */
export const visibilitySourceNearMissesSchema = responseObject({
  responses: z.number().int(),
  unavailable_engines: z.array(z.string()),
  items: z.array(
    responseObject({
      url: z.string(),
      url_hash: z.string().nullable(),
      domain: z.string(),
      title: z.string(),
      // Answers that read the page, and those of them that also cited it.
      retrieved: z.number().int(),
      cited: z.number().int(),
      last_retrieved_at: z.string(),
    }),
  ),
});

const sourceMoverSchema = responseObject({
  key: z.string(),
  // Citation share in each period, as a fraction, and its change in
  // percentage points. A source absent from one period has share 0 there.
  current_share: z.number(),
  previous_share: z.number(),
  delta: z.number(),
});

/** Sources ranked by change in citation share against the previous comparable period. */
export const visibilitySourceMoversSchema = responseObject({
  dimension: z.enum(['domain', 'url']),
  comparison_status: z.string(),
  risers: z.array(sourceMoverSchema),
  fallers: z.array(sourceMoverSchema),
});

/** One cited URL's own page: overview, engines, prompts and co-named brands. */
export const visibilitySourceUrlSchema = responseObject({
  url: z.string(),
  title: z.string(),
  retrievals: z.number().int(),
  citations: z.number().int(),
  responses: z.number().int(),
  citation_rate: z.number().nullable(),
  prompts: z.number().int(),
  // Within the SELECTION, so narrowing the period moves them. Never a claim
  // about when the page itself was published.
  first_seen: z.string().nullable(),
  last_seen: z.string().nullable(),
  engines: z.array(
    responseObject({
      logical_engine: z.string(),
      transport_model: z.string().nullable(),
      retrievals: z.number().int(),
    }),
  ),
  prompt_rows: z.array(
    responseObject({
      prompt_text: z.string(),
      topic: z.string().nullable(),
      responses: z.number().int(),
      last_seen: z.string().nullable(),
      engines: z.array(z.string()),
    }),
  ),
  // Named in the ANSWERS that cited this URL, never found on the page: a
  // mention is recorded against the response and nothing links it to the
  // citation beside it.
  brands: z.array(
    responseObject({
      kind: z.enum(['brand', 'competitor']),
      name: z.string(),
      responses: z.number().int(),
      logo_url: z.string().nullable(),
      website: z.string().nullable(),
    }),
  ),
  // The page itself, as this project last read it; null until the project
  // has a record of the page. `entities` come from the latest successful
  // reading only, so an unread page carries none rather than absences.
  page: responseObject({
    state: z.string(),
    reason: z.string().nullable(),
    read_at: z.string().nullable(),
    extracted_chars: z.number().int().nullable(),
    page_format: z.string(),
    page_format_method: z.string().nullable(),
    source_class: z.string().nullable(),
    entities: z.array(pageEntitySchema),
    // Where the business stands on the page, by the same rule as the URL table.
    standing: pageStandingSchema,
    // The open Action to get listed here, when competitors are on the page and you are not.
    action_id: uuid().nullable(),
  }).nullable(),
});

export const visibilityFanoutSummarySchema = responseObject({
  // Totals over the WHOLE selected run set: unaffected by paging or search.
  event_count: z.number().int(),
  distinct_queries: z.number().int(),
  // Query rows matching the current `search` (equal to `distinct_queries`
  // when no search is applied). What the table pages through.
  matched_queries: z.number().int(),
  coverage: z.record(z.string(), z.number().int()),
  next_cursor: z.string().nullable(),
  total_answers: z.number().int(),
  answers: z.array(
    responseObject({
      audit_id: uuid(),
      task_id: uuid(),
      prompt_text: z.string(),
      logical_engine: z.string(),
      brand_mentioned: z.boolean(),
      owned_domain_cited: z.boolean(),
    }),
  ),
  items: z.array(
    responseObject({
      query: z.string(),
      event_count: z.number().int(),
      prompt_count: z.number().int(),
      engines: z.array(z.string()),
      response_count: z.number().int(),
      brand_response_count: z.number().int(),
    }),
  ),
});
