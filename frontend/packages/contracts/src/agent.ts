import { z } from 'zod';

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);
const uuid = () => z.uuid();

// Queue-row lifecycle shared by every leased task.
const agentRunStatusSchema = z.enum([
  'queued',
  'leased',
  'running',
  'retry_wait',
  'succeeded',
  'failed',
  'cancelled',
]);

// One committed piece of an active run. A model call (`tool` null) is in
// flight (`working`), being processed (`processing`) or done (`reasoned`);
// each read it requested follows it with its `call_id` and outcome
// (`completed`, `unavailable`, `failed`, `refused`).
export const agentRunStepSchema = responseObject({
  ordinal: z.number().int(),
  status: z.string(),
  tool: z.string().nullable(),
  call_id: z.string().nullable(),
  model_attempt_id: uuid(),
  tool_attempt_id: uuid().nullable(),
  run_attempt: z.number().int(),
  runtime_version: z.string(),
  protocol_version: z.string(),
  registry_version: z.string(),
  skill_catalog_version: z.string(),
  projection_version: z.string(),
});

export const agentRunSchema = responseObject({
  id: uuid(),
  status: agentRunStatusSchema,
  skill_id: z.string().nullable(),
  skill_source: z.string().nullable(),
  steps_used: z.number().int(),
  attempt_count: z.number().int().optional(),
  error_code: z.string(),
  error_detail: z.string(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
  progress: z.array(agentRunStepSchema).default([]),
});

/** A read or built-in call's state while a turn runs. */
export const agentToolStatusSchema = z.enum([
  'started',
  'completed',
  'unavailable',
  'refused',
  'failed',
]);

/**
 * Live events of one interactive turn, streamed by `POST …/run` when the
 * browser accepts `text/event-stream`. Display only; the persisted chat read
 * stays the record and the saved reply replaces the streamed text.
 *
 * - `step`: a model call started (the heartbeat of a turn).
 * - `reply_delta`: the next piece of that call's answer text; a later call's
 *   text replaces an earlier call's.
 * - `document_delta`: the document being saved, so far (a snapshot).
 * - `thinking`: the next piece of that call's thinking summary.
 * - `tool`: one call's state, keyed by `call_id`; calls in one step run together.
 *   A provider-hosted web search is the tool `web_search`.
 */
export const agentTurnEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('step'), ordinal: z.number().int() }),
  z.object({ type: z.literal('reply_delta'), ordinal: z.number().int(), text: z.string() }),
  z.object({
    type: z.literal('document_delta'),
    ordinal: z.number().int(),
    title: z.string().nullable(),
    body: z.string().nullable(),
  }),
  z.object({ type: z.literal('thinking'), ordinal: z.number().int(), text: z.string() }),
  z.object({
    type: z.literal('tool'),
    ordinal: z.number().int(),
    call_id: z.string(),
    tool: z.string(),
    status: agentToolStatusSchema,
  }),
  z.object({ type: z.literal('done'), run: agentRunSchema }),
  z.object({ type: z.literal('error'), code: z.string() }),
]);

/** A web page a search returned: an untrusted observation, apart from CiteLadder records. */
export const agentWebSourceSchema = responseObject({ url: z.string(), title: z.string() });

/** A page document's SEO block, as fetched (revision 1) or as last edited. */
export const agentPageFieldsSchema = responseObject({
  title: z.string(),
  meta_description: z.string(),
  json_ld: z.string(),
});

// `fetch` authors revision 1 of a page document: the live page as fetched.
export const agentRevisionSchema = responseObject({
  id: uuid(),
  number: z.number().int(),
  parent_revision_id: uuid().nullable(),
  author: z.enum(['agent', 'user', 'fetch']),
  title: z.string(),
  body: z.string(),
  // A page revision's SEO fields; null for every other kind of document.
  fields: agentPageFieldsSchema.nullable().default(null),
  source_refs: z.array(z.string()),
  web_sources: z.array(agentWebSourceSchema),
  created_at: z.string(),
});

// One of a chat's documents; `number` is its label ("Document 2"), in creation order.
export const agentOutputSchema = responseObject({
  id: uuid(),
  number: z.number().int(),
  // Latest generating reply; user edits and restores keep this placement.
  message_id: uuid().nullish(),
  action_id: uuid().nullable(),
  kind: z.string(),
  skill_id: z.string(),
  format_id: z.string().nullable(),
  target_kind: z.string().nullable(),
  target_label: z.string().nullable(),
  // The page or topic the document names apart from its Action, until the
  // person links the document to it or keeps it with its Action.
  named_target: responseObject({
    kind: z.enum(['page', 'planned_page']),
    target: z.string(),
  })
    .nullable()
    .default(null),
  // Every document has at least one revision.
  latest_revision: agentRevisionSchema,
});

// A step summary is `{kind: 'model', ordinal}`, `{kind: 'skill', skill_id}`,
// `{kind: 'document'}`, `{kind: 'tool', tool, status, call_id, ordinal}` or
// `{kind: 'search', query, status, call_id, ordinal}` (a web search).
const agentStepSchema = responseObject({
  kind: z.string(),
  ordinal: z.number().int().optional(),
  skill_id: z.string().optional(),
  tool: z.string().optional(),
  status: z.string().optional(),
  call_id: z.string().optional(),
  query: z.string().optional(),
});

export const agentMessageSchema = responseObject({
  id: uuid(),
  sequence: z.number().int(),
  role: z.enum(['user', 'agent']),
  content: z.string(),
  skill_id: z.string().nullable(),
  skill_source: z.string().nullable(),
  evidence_refs: z.array(z.string()),
  web_sources: z.array(agentWebSourceSchema).default([]),
  steps: z.array(agentStepSchema),
  // Actions a user message @-mentioned, as resolved when it was sent.
  mentions: z
    .array(responseObject({ kind: z.string(), id: uuid(), label: z.string() }))
    .default([]),
  created_at: z.string(),
});

export const agentChatSummarySchema = responseObject({
  id: uuid(),
  project_id: uuid(),
  action_id: uuid().nullable(),
  target_label: z.string().nullable(),
  title: z.string(),
  turn_count: z.number().int(),
  output_kind: z.string().nullable(),
  last_activity_at: z.string(),
  created_at: z.string(),
  /** A turn is queued or running in this chat. */
  running: z.boolean(),
});

export const agentChatsPageSchema = responseObject({
  items: z.array(agentChatSummarySchema),
  next_cursor: z.string().nullable(),
});

const agentContextDisclosureSchema = responseObject({
  refs: z.record(z.string(), z.json()).default({}),
  instructions: responseObject({ revision: z.number().int() }).nullable().default(null),
  action: responseObject({ id: uuid(), label: z.string() }).nullable().default(null),
  mentions: z.array(responseObject({ id: uuid(), label: z.string() })).default([]),
  sources: z.array(z.json()).default([]),
  limitations: z.array(z.json()).default([]),
  prompt: z.record(z.string(), z.json()).default({}),
});
/** How one fetch of a live page ended; only `fetched` gives the chat a page document. */
export const pageFetchOutcomeSchema = z.enum([
  'fetched',
  'blocked_robots',
  'http_error',
  'unsupported',
  'failed',
]);

/**
 * One of Site Health's page-local checks as it judged the fetched page (E5):
 * its rule and title, severity and outcome, and whether that outcome fails.
 * Editing the page does not rerun it.
 */
export const agentPageCheckSchema = responseObject({
  rule_id: z.string(),
  label: z.string(),
  severity: z.string(),
  outcome: z.string(),
  failing: z.boolean(),
});

/**
 * The page fetch a page chat starts with. `reading` until it ends; then its
 * outcome, when the page was fetched (null when the fetch never ran, for
 * example after an internal failure) and the page-local checks shown for it.
 */
export const agentPageFetchSchema = z.discriminatedUnion('status', [
  responseObject({ status: z.literal('reading') }),
  responseObject({
    status: z.literal('done'),
    outcome: pageFetchOutcomeSchema,
    fetched_at: z.string().nullable(),
    checks: z.array(agentPageCheckSchema).default([]),
  }),
]);

export const agentChatDetailSchema = responseObject({
  chat: agentChatSummarySchema,
  pinned_skill_id: z.string().nullable(),
  context: agentContextDisclosureSchema.partial(),
  messages: z.array(agentMessageSchema),
  latest_run: agentRunSchema.nullable(),
  // The chat's documents in number order.
  outputs: z.array(agentOutputSchema),
  // A page chat's fetch; null for every other chat.
  page_fetch: agentPageFetchSchema.nullable().default(null),
});

/** An accepted follow-up: its chat and the queued turn. */
export const agentTurnAcceptedSchema = responseObject({
  chat_id: uuid(),
  run: agentRunSchema,
});

/**
 * An accepted new chat. A page chat (`optimize_page`) starts with a page fetch
 * instead of a turn, so its `run` is null until the fetch queues one; the
 * chat read shows that turn as `latest_run`.
 */
export const agentChatCreatedSchema = responseObject({
  chat_id: uuid(),
  run: agentRunSchema.nullable(),
});

export const agentRevisionsPageSchema = responseObject({
  items: z.array(agentRevisionSchema),
});

/** An SEO field of a page document. */
export const agentPageFieldSchema = agentPageFieldsSchema.keyof();
/** A half-open range of the Markdown body in UTF-16 code units, as JavaScript and CodeMirror count. */
const agentBodySpanSchema = responseObject({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

/**
 * Where a suggestion points in the revision it was made against (content rules
 * engine, "Findings and anchoring"): a span of the body with its exact text and
 * about 32 characters of context each side, an SEO field with the value it had,
 * or the page as a whole.
 */
export const agentSuggestionAnchorSchema = z.discriminatedUnion('kind', [
  responseObject({
    kind: z.literal('span'),
    position: agentBodySpanSchema,
    quote: responseObject({ exact: z.string(), prefix: z.string(), suffix: z.string() }),
  }),
  responseObject({ kind: z.literal('field'), field: agentPageFieldSchema, expected: z.string() }),
  responseObject({ kind: z.literal('page') }),
]);

/**
 * What a suggestion's judgement read; a change to any of it makes the
 * suggestion stale. A `section` is the body between the headings around the
 * span, in the suggestion's own revision.
 */
export const agentSuggestionDependencySchema = z.discriminatedUnion('kind', [
  responseObject({ kind: z.literal('span') }),
  responseObject({
    kind: z.literal('section'),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }),
  responseObject({ kind: z.literal('body') }),
  responseObject({ kind: z.literal('field'), field: agentPageFieldSchema }),
]);

/** Why a suggestion went stale: its text, its field or a dependency changed, or a newer suggestion replaced it. */
export const agentSuggestionStaleReasonSchema = z.enum([
  'span_changed',
  'field_changed',
  'dependency_changed',
  'replaced',
]);

/** One status change; `reverted` returns a suggestion to open. */
const agentSuggestionEventSchema = responseObject({
  status: z.enum(['open', 'applied', 'dismissed', 'reverted', 'stale']),
  actor: z.enum(['agent', 'user', 'system']),
  revision_id: uuid().nullable(),
  reason: agentSuggestionStaleReasonSchema.nullable(),
  created_at: z.string(),
});

/**
 * Where a suggestion's rule comes from, as stored when it was made: a
 * `requirement` restates a search-engine policy, a `recommendation` is guidance
 * offered as an option, and a `heuristic` is a tool convention or contested
 * evidence, also an option.
 */
export const agentSuggestionGuidanceSchema = responseObject({
  strength: z.enum(['requirement', 'recommendation', 'heuristic']),
  source_label: z.string(),
  source_url: z.string(),
});

/**
 * One suggestion on a page document. `ready` carries replacement text,
 * `needs_input` asks the person for a fact and `advice` has neither.
 * `position` is where its text is in the latest revision: an open span's
 * quote, or an applied span's replacement; null for a field, the page, or text
 * that is no longer there. `choose_one` marks an open ready suggestion that
 * overlaps another open one, which Apply all leaves for the person.
 */
export const agentSuggestionSchema = responseObject({
  id: uuid(),
  output_id: uuid(),
  revision_id: uuid(),
  source: z.enum(['model', 'site_health']),
  category: z.string(),
  rule_id: z.string(),
  /** Null for a suggestion made before the rule catalog. */
  guidance: agentSuggestionGuidanceSchema.nullable(),
  rationale: z.string(),
  anchor: agentSuggestionAnchorSchema,
  depends_on: z.array(agentSuggestionDependencySchema),
  replacement: z.string().nullable(),
  needs_input: z.string().nullable(),
  status: z.enum(['open', 'applied', 'dismissed', 'stale']),
  readiness: z.enum(['ready', 'needs_input', 'advice']),
  position: agentBodySpanSchema.nullable(),
  choose_one: z.boolean(),
  events: z.array(agentSuggestionEventSchema),
  created_at: z.string(),
});

/**
 * A page document's open, applied and dismissed suggestions against its latest
 * revision, in position order, with counts per status and open ones per
 * category. Stale suggestions are counted, not listed.
 */
export const agentSuggestionsPageSchema = responseObject({
  revision_id: uuid(),
  items: z.array(agentSuggestionSchema),
  counts: responseObject({
    open: z.number().int(),
    applied: z.number().int(),
    dismissed: z.number().int(),
    stale: z.number().int(),
    needs_input: z.number().int(),
    by_category: z.array(responseObject({ category: z.string(), open: z.number().int() })),
  }),
});

/**
 * Apply, Dismiss or Revert on one suggestion. A check that failed marks it
 * `stale` with its reason instead; `revision` is the revision the change
 * appended, if it appended one.
 */
export const agentSuggestionResultSchema = responseObject({
  outcome: z.enum(['applied', 'dismissed', 'reverted', 'stale']),
  reason: agentSuggestionStaleReasonSchema.nullable(),
  suggestion: agentSuggestionSchema,
  revision: agentRevisionSchema.nullable(),
});

/**
 * Apply all: the ready suggestions applied in one revision, those left for the
 * person to choose between, the open ones that need input (always skipped)
 * and the ones that went stale on the way.
 */
export const agentSuggestionsAppliedSchema = responseObject({
  applied: z.number().int(),
  left_to_choose: z.number().int(),
  needs_input: z.number().int(),
  stale: z.number().int(),
  revision: agentRevisionSchema.nullable(),
});

export const agentSuggestionsDismissedSchema = responseObject({ dismissed: z.number().int() });

export const agentSkillSchema = responseObject({
  id: z.string(),
  label: z.string(),
  group: z.string(),
  output_kind: z.string(),
  description: z.string(),
});

export const agentWorkflowSchema = responseObject({
  id: z.string(),
  group: z.string(),
  label: z.string(),
  description: z.string(),
  skill_id: z.string(),
  format_id: z.string().nullable(),
  prompt: z.string(),
  inputs: z.array(responseObject({ key: z.string(), label: z.string(), required: z.boolean() })),
});

// What a finished deliverable of one kind is called and offers next.
const agentOutputKindSchema = responseObject({
  kind: z.string(),
  label: z.string(),
  refinements: z.array(z.string()),
  next: z.array(responseObject({ workflow_id: z.string(), prompt: z.string() })),
});

export const agentSkillCatalogSchema = responseObject({
  skills: z.array(agentSkillSchema),
  workflow_groups: z.array(responseObject({ id: z.string(), label: z.string() })).default([]),
  workflows: z.array(agentWorkflowSchema).default([]),
  output_kinds: z.array(agentOutputKindSchema).default([]),
  /** Bounds the API enforces on a composed message, for the composer that reads this catalog. */
  limits: responseObject({ mentions_max: z.number().int() }),
});

export const agentInstructionsSchema = responseObject({
  revision: z.number().int().nullable(),
  text: z.string(),
  created_at: z.string().nullable(),
});

function compareCheckpoints(left: string, right: string) {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

const agentSiteHealthReferenceSchema = z.object({
  project_id: uuid(),
  crawl_id: uuid(),
  site_url_id: uuid(),
  source_analysis_id: uuid(),
  dimension: z.string().min(1).max(32),
  checkpoint_ids: z
    .array(z.string().max(64))
    .min(1)
    .max(16)
    .transform((ids) => [...new Set(ids)].sort(compareCheckpoints)),
});
const agentSearchReferenceSchema = z.object({
  dataset_id: uuid(),
  row_ids: z
    .array(uuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'Row IDs must be unique'),
});
export const agentContextRefsSchema = z.strictObject({
  target_site_url_id: uuid().nullish(),
  target_url: z.string().max(2048).nullish(),
  opportunity_id: uuid().nullish(),
  demand_signal_id: uuid().nullish(),
  site_health_reference: agentSiteHealthReferenceSchema.nullish(),
  issue_group_reference: z
    .strictObject({ crawl_id: uuid(), group_id: uuid(), site_url_id: uuid().optional() })
    .nullish(),
  site_facts_reference: z.strictObject({ crawl_id: uuid() }).nullish(),
  output_revision_reference: z.strictObject({ output_id: uuid(), revision_id: uuid() }).nullish(),
  search_intelligence_reference: agentSearchReferenceSchema.nullish(),
  // The live page a page chat fetched; the fetch sets it before the first turn.
  page_snapshot_reference: z.strictObject({ snapshot_id: uuid() }).nullish(),
  // The topic and tracked prompts a page is optimized for (Analyze a page, CO6).
  prompt_reference: z
    .strictObject({ topic_id: uuid(), prompt_ids: z.array(uuid()).min(1).max(100) })
    .nullish(),
});
/**
 * Typed evidence a new chat starts from. The server resolves and authorizes
 * every identifier on each run; the browser never sends evidence content.
 */
export type AgentContextRefs = z.input<typeof agentContextRefsSchema>;

/** Request bounds come from the policy owner; the shared wire shape lives here. */
export function agentRequestSchemas(bounds: {
  message_max_chars: number;
  mentions_max: number;
  output_title_max_chars: number;
  output_body_max_chars: number;
  instructions_max_chars: number;
}) {
  const message = z.string().max(bounds.message_max_chars).trim().min(1);
  const skill = z.string().max(64).nullish();
  const workflow = z.string().max(64).nullish();
  const mentions = z
    .array(uuid())
    .max(bounds.mentions_max)
    .refine((ids) => new Set(ids).size === ids.length, 'Mentioned Actions must be unique')
    .default([]);
  return {
    create: z.strictObject({
      message,
      skill_id: skill,
      workflow_id: workflow,
      action_id: uuid().nullish(),
      context: agentContextRefsSchema.default({}),
      mentions,
    }),
    message: z.strictObject({ message, skill_id: skill, mentions }),
    edit: z.strictObject({
      base_revision_id: uuid(),
      title: z.string().max(bounds.output_title_max_chars).trim().min(1),
      body: z.string().max(bounds.output_body_max_chars).trim().min(1),
    }),
    instructions: z.strictObject({ text: z.string().max(bounds.instructions_max_chars) }),
    // Every suggestion change names the latest revision the person saw.
    suggestion: z.strictObject({ base_revision_id: uuid() }),
    // A document naming another page than its Action: link it there or keep it.
    target: z.strictObject({ decision: z.enum(['link', 'keep']) }),
  };
}
type AgentRequestSchemas = ReturnType<typeof agentRequestSchemas>;
/** A new chat; a defined workflow pins its skill and format on the server. */
export type AgentChatCreateRequest = z.input<AgentRequestSchemas['create']>;
export type AgentMessageRequest = z.input<AgentRequestSchemas['message']>;
export type AgentOutputEditRequest = z.input<AgentRequestSchemas['edit']>;
export type AgentInstructionsRequest = z.input<AgentRequestSchemas['instructions']>;
export type AgentOutputTargetRequest = z.input<AgentRequestSchemas['target']>;
