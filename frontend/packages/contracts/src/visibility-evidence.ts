import { z } from 'zod';
import { citationSchema } from './audits.ts';
import { brandMarkFields } from './brand-mark.ts';
import { pageEntitySchema } from './source-pages.ts';
import { namedBrandSchema } from './visibility.ts';

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

const visibilityEvidenceSearchEventSchema = responseObject({
  sequence: z.number().int(),
  query: z.string(),
  call_id: z.string(),
  call_sequence: z.number().int(),
  query_sequence: z.number().int(),
});

const visibilityMentionEvidenceSchema = responseObject({
  kind: z.enum(['brand', 'competitor']),
  name: z.string(),
  ...brandMarkFields,
  first_offset: z.number().int().nullable(),
  artifact_id: uuid().nullable(),
  analyzer_version: z.string(),
});

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
  retrieval_enabled: z.boolean(),
  search_used: z.boolean(),
  search_query_count: z.number().int(),
  query_text_available: z.boolean(),
  state: visibilityFanoutStateSchema,
  search_events: z.array(visibilityEvidenceSearchEventSchema),
  event_source: z.enum(['raw_artifact', 'audit_task', 'none']),
  mentions: z.array(visibilityMentionEvidenceSchema),
  citations: z.array(citationSchema),
});

export const visibilityEvidenceResponseSchema = responseObject({
  items: z.array(visibilityExecutionEvidenceSchema),
  truncated: z.boolean(),
  total: z.number().int().optional(),
  next_cursor: z.string().nullable().optional(),
  as_of: z.string().nullable().optional(),
  prompt_options: z.array(responseObject({ id: uuid(), label: z.string() })).optional(),
});

export const pageStandingSchema = z.enum([
  'yours',
  'competitor',
  'blocked',
  'unreadable',
  'not_read',
  'gap',
  'listed',
  'read',
  'not_assessable',
]);

export const visibilitySourcesSchema = responseObject({
  previous_cursor: z.string().nullable().optional(),
  total: z.number().int(),
  responses: z.number().int(),
  prompts: z.number().int(),
  total_citations: z.number().int(),
  category_totals: z.record(z.string(), z.number().int()).optional(),
  next_cursor: z.string().nullable(),
  as_of: z.string(),
  comparison_status: z.string(),
  retrieval: responseObject({
    responses: z.number().int(),
    unavailable_engines: z.array(z.string()),
  }),
  items: z.array(
    responseObject({
      key: z.string(),
      retrieved: z.number().int().nullable(),
      responses: z.number().int(),
      prompts: z.number().int(),
      annotations: z.number().int(),
      urls: z.number().int(),
      response_rate: z.number().nullable(),
      prompt_coverage: z.number().nullable(),
      retrieval_rate: z.number().nullable(),
      citation_share: z.number().nullable(),
      citation_rate: z.number().nullable(),
      ownership: z.array(z.string()),
      categories: z.array(z.string()),
      taxonomy_versions: z.array(z.string()),
      category_unavailable: z.boolean(),
      response_delta: z.number().nullable(),
      url_hash: z.string().nullable(),
      inspection_state: z.string().nullable(),
      opportunity_id: uuid().nullable(),
      standing: pageStandingSchema.nullable(),
      action_id: uuid().nullable(),
      title: z.string().nullable(),
      page_format: z.string().nullable(),
      page_format_method: z.string().nullable(),
      last_cited_at: z.string().nullable(),
      mentions: z.number().int(),
      brands: z.array(namedBrandSchema),
    }),
  ),
});

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
          share: z.number().nullable(),
        }),
      ),
    }),
  ),
});

export const visibilitySourceNearMissesSchema = responseObject({
  responses: z.number().int(),
  unavailable_engines: z.array(z.string()),
  items: z.array(
    responseObject({
      url: z.string(),
      url_hash: z.string().nullable(),
      domain: z.string(),
      title: z.string(),
      retrieved: z.number().int(),
      cited: z.number().int(),
      last_retrieved_at: z.string(),
    }),
  ),
});

const sourceMoverSchema = responseObject({
  key: z.string(),
  current_share: z.number(),
  previous_share: z.number(),
  delta: z.number(),
});

export const visibilitySourceMoversSchema = responseObject({
  dimension: z.enum(['domain', 'url']),
  comparison_status: z.string(),
  risers: z.array(sourceMoverSchema),
  fallers: z.array(sourceMoverSchema),
});

export const visibilitySourceUrlSchema = responseObject({
  url: z.string(),
  title: z.string(),
  retrievals: z.number().int(),
  citations: z.number().int(),
  responses: z.number().int(),
  citation_rate: z.number().nullable(),
  prompts: z.number().int(),
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
  brands: z.array(
    responseObject({
      kind: z.enum(['brand', 'competitor']),
      name: z.string(),
      responses: z.number().int(),
      logo_url: z.string().nullable(),
      website: z.string().nullable(),
    }),
  ),
  page: responseObject({
    state: z.string(),
    reason: z.string().nullable(),
    read_at: z.string().nullable(),
    extracted_chars: z.number().int().nullable(),
    page_format: z.string(),
    page_format_method: z.string().nullable(),
    source_class: z.string().nullable(),
    entities: z.array(pageEntitySchema),
    standing: pageStandingSchema,
    action_id: uuid().nullable(),
  }).nullable(),
});

export const visibilityFanoutSummarySchema = responseObject({
  event_count: z
    .number()
    .int()
    .describe('Searches the answers ran, over the whole selection; paging and `search` ignored.'),
  distinct_queries: z.number().int().describe('Distinct queries over the whole selection.'),
  matched_queries: z
    .number()
    .int()
    .describe('Queries matching `search`: what the rows page through.'),
  coverage: z
    .record(z.string(), z.number().int())
    .describe(
      'Answers per fanout state, such as `queries_available`, `count_only`, `no_search` or `unavailable`.',
    ),
  next_cursor: z.string().nullable(),
  compared: z
    .boolean()
    .describe(
      'Whether `change` is filled: a one-run selection with a previous comparable run that reported searches.',
    ),
  total_answers: z.number().int().describe('With `query`: answers that searched it.'),
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
      event_count: z.number().int().describe('Times the answers searched this query.'),
      prompt_count: z.number().int().describe('Prompts whose answers searched it.'),
      engines: z.array(z.string()),
      response_count: z.number().int().describe('Answers that searched it.'),
      brand_response_count: z.number().int().describe('Of those, answers that named the brand.'),
      share: z.number().describe('Its share of every search the filters keep, 0–1 (AV-8).'),
      change: z
        .number()
        .nullable()
        .describe('`share` minus its share in the previous comparable run. Null: not compared.'),
      brands: z
        .array(namedBrandSchema.omit({ responses: true }))
        .nullable()
        .describe(
          'Tracked businesses the query text names. Null: measured before fanout queries were counted.',
        ),
    }),
  ),
});
export type FanoutQueryRow = z.infer<typeof visibilityFanoutSummarySchema>['items'][number];

export type VisibilityExecutionEvidence = z.infer<typeof visibilityExecutionEvidenceSchema>;
export type VisibilityEvidenceResponse = z.infer<typeof visibilityEvidenceResponseSchema>;
