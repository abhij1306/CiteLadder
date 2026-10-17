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
  mode: z.enum(['turn', 'draft_from_outline']),
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

export const agentOutputPhaseSchema = z.enum(['outline', 'draft', 'final']);

export const agentRevisionSchema = responseObject({
  id: uuid(),
  number: z.number().int(),
  parent_revision_id: uuid().nullable(),
  author: z.enum(['agent', 'user']),
  phase: agentOutputPhaseSchema,
  title: z.string(),
  body: z.string(),
  source_refs: z.array(z.string()),
  approved_at: z.string().nullable(),
  created_at: z.string(),
});

export const agentOutputSchema = responseObject({
  id: uuid(),
  // Latest generating reply; user edits and restores keep this placement.
  message_id: uuid().nullish(),
  action_id: uuid().nullable(),
  kind: z.string(),
  skill_id: z.string(),
  format_id: z.string().nullable(),
  target_kind: z.string().nullable(),
  target_label: z.string().nullable(),
  phase: agentOutputPhaseSchema,
  latest_revision: agentRevisionSchema.nullable(),
});

// A step summary is `{kind: 'model', ordinal}`, `{kind: 'skill', skill_id}`,
// `{kind: 'document'}` or `{kind: 'tool', tool, status, call_id, ordinal}`.
const agentStepSchema = responseObject({
  kind: z.string(),
  ordinal: z.number().int().optional(),
  skill_id: z.string().optional(),
  tool: z.string().optional(),
  status: z.string().optional(),
  call_id: z.string().optional(),
});

export const agentMessageSchema = responseObject({
  id: uuid(),
  sequence: z.number().int(),
  role: z.enum(['user', 'agent']),
  content: z.string(),
  skill_id: z.string().nullable(),
  skill_source: z.string().nullable(),
  evidence_refs: z.array(z.string()),
  steps: z.array(agentStepSchema),
  // Actions a user message @-mentioned, as resolved when it was sent.
  mentions: z
    .array(responseObject({ kind: z.string(), id: uuid(), label: z.string() }))
    .default([]),
  created_at: z.string(),
  event: responseObject({
    kind: z.literal('outline_approved'),
    revision_id: uuid(),
    run_id: uuid(),
  })
    .nullable()
    .optional(),
});

export const agentChatSummarySchema = responseObject({
  id: uuid(),
  project_id: uuid(),
  action_id: uuid().nullable(),
  target_label: z.string().nullable(),
  title: z.string(),
  turn_count: z.number().int(),
  output_kind: z.string().nullable(),
  output_phase: agentOutputPhaseSchema.nullable(),
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
export const agentChatDetailSchema = responseObject({
  chat: agentChatSummarySchema,
  pinned_skill_id: z.string().nullable(),
  context: agentContextDisclosureSchema.partial(),
  messages: z.array(agentMessageSchema),
  latest_run: agentRunSchema.nullable(),
  output: agentOutputSchema.nullable(),
});

export const agentTurnAcceptedSchema = responseObject({
  chat_id: uuid(),
  run: agentRunSchema,
});

export const agentRevisionsPageSchema = responseObject({
  items: z.array(agentRevisionSchema),
});

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
export const agentContextRefsSchema = z
  .object({
    target_site_url_id: uuid().nullish(),
    target_url: z.string().max(2048).nullish(),
    opportunity_id: uuid().nullish(),
    demand_signal_id: uuid().nullish(),
    site_health_reference: agentSiteHealthReferenceSchema.nullish(),
    issue_group_reference: z
      .object({ crawl_id: uuid(), group_id: uuid(), site_url_id: uuid().optional() })
      .strict()
      .nullish(),
    site_facts_reference: z.object({ crawl_id: uuid() }).strict().nullish(),
    output_revision_reference: z
      .object({ output_id: uuid(), revision_id: uuid() })
      .strict()
      .nullish(),
    search_intelligence_reference: agentSearchReferenceSchema.nullish(),
  })
  .strict();

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
    create: z
      .object({
        message,
        skill_id: skill,
        workflow_id: workflow,
        action_id: uuid().nullish(),
        context: agentContextRefsSchema.default({}),
        mentions,
      })
      .strict(),
    message: z.object({ message, skill_id: skill, mentions }).strict(),
    edit: z
      .object({
        base_revision_id: uuid(),
        title: z.string().max(bounds.output_title_max_chars).trim().min(1),
        body: z.string().max(bounds.output_body_max_chars).trim().min(1),
      })
      .strict(),
    approve: z.object({ revision_id: uuid() }).strict(),
    instructions: z.object({ text: z.string().max(bounds.instructions_max_chars) }).strict(),
  };
}
