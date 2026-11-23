import { z } from 'zod';

import { actionStatusSchema } from './action-status.ts';
import { agentViewSchema } from './agent-views.ts';

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);
const uuid = () => z.uuid();

const agentRunStatusSchema = z.enum([
  'queued',
  'leased',
  'running',
  'retry_wait',
  'succeeded',
  'failed',
  'cancelled',
]);

export const agentRunStepSchema = responseObject({
  ordinal: z.number().int(),
  status: z.string(),
  tool: z.string().nullable(),
  call_id: z.string().nullable(),
  run_attempt: z.number().int(),
  target: z.string().nullable(),
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

export const agentToolStatusSchema = z.enum([
  'started',
  'completed',
  'unavailable',
  'refused',
  'failed',
]);

export const agentTurnEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('step'), ordinal: z.number().int() }),
  z.object({ type: z.literal('reply_delta'), ordinal: z.number().int(), text: z.string() }),
  z.object({
    type: z.literal('document_delta'),
    ordinal: z.number().int(),
    title: z.string().nullable(),
    from: z.number().int().nonnegative(),
    text: z.string().nullable(),
  }),
  z.object({ type: z.literal('thinking'), ordinal: z.number().int(), text: z.string() }),
  z.object({
    type: z.literal('tool'),
    ordinal: z.number().int(),
    call_id: z.string(),
    tool: z.string(),
    status: agentToolStatusSchema,
    target: z.string().nullable().default(null),
  }),
  z.object({ type: z.literal('done'), run: agentRunSchema }),
  z.object({ type: z.literal('error'), code: z.string() }),
]);

export const agentWebSourceSchema = responseObject({ url: z.string(), title: z.string() });

export const agentPageFieldsSchema = responseObject({
  title: z.string(),
  meta_description: z.string(),
  json_ld: z.string(),
});

export const agentRevisionSchema = responseObject({
  id: uuid(),
  number: z.number().int(),
  parent_revision_id: uuid().nullable(),
  author: z.enum(['agent', 'user', 'fetch']),
  title: z.string(),
  body: z.string(),
  fields: agentPageFieldsSchema.nullable().default(null),
  source_refs: z.array(z.string()),
  web_sources: z.array(agentWebSourceSchema),
  created_at: z.string(),
});

export const agentOutputSchema = responseObject({
  id: uuid(),
  number: z.number().int(),
  message_id: uuid().nullish(),
  action_id: uuid().nullable(),
  kind: z.string(),
  skill_id: z.string(),
  format_id: z.string().nullable(),
  target_kind: z.string().nullable(),
  target_label: z.string().nullable(),
  named_target: responseObject({
    kind: z.enum(['page', 'planned_page']),
    target: z.string(),
  })
    .nullable()
    .default(null),
  latest_revision: agentRevisionSchema,
});

export const agentStepSchema = z.discriminatedUnion('kind', [
  responseObject({ kind: z.literal('model'), ordinal: z.number().int() }),
  responseObject({ kind: z.literal('skill'), skill_id: z.string() }),
  responseObject({
    kind: z.literal('document'),
    action: z.enum(['created', 'replaced', 'edited']),
    number: z.number().int(),
    title: z.string(),
  }),
  responseObject({ kind: z.literal('suggestion') }),
  responseObject({ kind: z.literal('proposal'), label: z.string() }),
  responseObject({ kind: z.literal('change'), label: z.string() }),
  responseObject({
    kind: z.literal('tool'),
    ordinal: z.number().int(),
    tool: z.string(),
    status: z.string(),
    call_id: z.string(),
    target: z.string().nullable().default(null),
  }),
  responseObject({
    kind: z.literal('search'),
    ordinal: z.number().int(),
    status: z.string(),
    call_id: z.string(),
    query: z.string(),
  }),
]);
export type AgentStep = z.infer<typeof agentStepSchema>;

export const AGENT_ATTACHMENT_NAME_MAX_CHARS = 255;
function attachmentSchema(text: z.ZodString) {
  return z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('pasted_text'), text }),
    z.strictObject({
      kind: z.literal('file'),
      name: z.string().trim().min(1).max(AGENT_ATTACHMENT_NAME_MAX_CHARS),
      text,
    }),
  ]);
}
export const agentAttachmentSchema = attachmentSchema(z.string());
export type AgentAttachment = z.infer<typeof agentAttachmentSchema>;
export const attachedChars = (items: readonly Pick<AgentAttachment, 'text'>[]) =>
  items.reduce((sum, item) => sum + item.text.length, 0);

export const agentDeclarationProposalSchema = responseObject({
  kind: z.literal('declaration'),
  action_id: uuid(),
  revision: responseObject({ id: uuid(), number: z.number().int() }).nullable(),
  go_live_day: z.iso.date().nullable(),
  deployment_reference: z.string().nullable(),
});
export const agentProposalSchema = z.discriminatedUnion('kind', [
  agentDeclarationProposalSchema,
  responseObject({
    kind: z.literal('change'),
    index: z.number().int().nonnegative(),
    title: z.string(),
    rows: z.array(responseObject({ label: z.string(), value: z.string() })),
    spend: z.string().nullable(),
    opens: responseObject({ label: z.string(), path: z.string() }).nullable(),
    outcome: z.enum(['open', 'executed', 'dismissed', 'unavailable']),
    refusal: z.string().nullable().default(null),
  }),
]);
export type AgentProposal = z.infer<typeof agentProposalSchema>;

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
  mentions: z
    .array(responseObject({ kind: z.string(), id: uuid(), label: z.string() }))
    .default([]),
  attachments: z.array(agentAttachmentSchema).default([]),
  proposals: z.array(agentProposalSchema).default([]),
  views: z.array(agentViewSchema).default([]),
  created_at: z.string(),
});

export const agentChatOriginSchema = z.enum([
  'site_health',
  'page',
  'recommendation',
  'demand',
  'keyword_research',
  'prompts',
  'objection',
  'action',
  'chat',
]);
export type AgentChatOrigin = z.infer<typeof agentChatOriginSchema>;

export const agentChatSummarySchema = responseObject({
  id: uuid(),
  project_id: uuid(),
  action_id: uuid().nullable(),
  origin: agentChatOriginSchema,
  target_label: z.string().nullable(),
  title: z.string(),
  turn_count: z.number().int(),
  output_kind: z.string().nullable(),
  last_activity_at: z.string(),
  created_at: z.string(),
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
export const pageFetchOutcomeSchema = z.enum([
  'fetched',
  'blocked_robots',
  'http_error',
  'unsupported',
  'failed',
]);

export const agentPageCheckSchema = responseObject({
  rule_id: z.string(),
  label: z.string(),
  severity: z.string(),
  outcome: z.string(),
  failing: z.boolean(),
});

export const agentPageFetchSchema = z.discriminatedUnion('status', [
  responseObject({ status: z.literal('reading') }),
  responseObject({
    status: z.literal('done'),
    outcome: pageFetchOutcomeSchema,
    fetched_at: z.string().nullable(),
    checks: z.array(agentPageCheckSchema).default([]),
  }),
]);

export const agentReasoningEffortSchema = z.enum(['low', 'medium', 'high']);
export type AgentReasoningEffort = z.infer<typeof agentReasoningEffortSchema>;

export const agentChatDetailSchema = responseObject({
  chat: agentChatSummarySchema,
  pinned_skill_id: z.string().nullable(),
  model: responseObject({
    id: z.string(),
    reasoning_effort: agentReasoningEffortSchema,
    locked: z.boolean(),
  }),
  context: agentContextDisclosureSchema.partial(),
  messages: z.array(agentMessageSchema),
  latest_run: agentRunSchema.nullable(),
  outputs: z.array(agentOutputSchema),
  page_fetch: agentPageFetchSchema.nullable().default(null),
  actions: z
    .array(responseObject({ id: uuid(), target_label: z.string(), status: actionStatusSchema }))
    .default([]),
});

export const agentTurnAcceptedSchema = responseObject({
  chat_id: uuid(),
  run: agentRunSchema,
});

export const agentChatCreatedSchema = responseObject({
  chat_id: uuid(),
  run: agentRunSchema.nullable(),
});

export const agentRevisionsPageSchema = responseObject({
  items: z.array(agentRevisionSchema),
});

export const agentPageFieldSchema = agentPageFieldsSchema.keyof();
const agentBodySpanSchema = responseObject({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

export const agentSuggestionAnchorSchema = z.discriminatedUnion('kind', [
  responseObject({
    kind: z.literal('span'),
    position: agentBodySpanSchema,
    quote: responseObject({ exact: z.string(), prefix: z.string(), suffix: z.string() }),
  }),
  responseObject({ kind: z.literal('field'), field: agentPageFieldSchema, expected: z.string() }),
  responseObject({ kind: z.literal('page') }),
]);

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

export const agentSuggestionStaleReasonSchema = z.enum([
  'span_changed',
  'field_changed',
  'dependency_changed',
  'replaced',
]);

const agentSuggestionEventSchema = responseObject({
  status: z.enum(['open', 'applied', 'dismissed', 'reverted', 'stale']),
  actor: z.enum(['agent', 'user', 'system']),
  revision_id: uuid().nullable(),
  reason: agentSuggestionStaleReasonSchema.nullable(),
  created_at: z.string(),
});

export const agentSuggestionGuidanceSchema = responseObject({
  strength: z.enum(['requirement', 'recommendation', 'heuristic']),
  source_label: z.string(),
  source_url: z.string(),
});

export const agentSuggestionSchema = responseObject({
  id: uuid(),
  output_id: uuid(),
  revision_id: uuid(),
  source: z.enum(['model', 'site_health']),
  category: z.string(),
  rule_id: z.string(),
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

export const agentSuggestionResultSchema = responseObject({
  outcome: z.enum(['applied', 'dismissed', 'reverted', 'stale']),
  reason: agentSuggestionStaleReasonSchema.nullable(),
  suggestion: agentSuggestionSchema,
  revision: agentRevisionSchema.nullable(),
});

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
  label: z.string(),
});

const agentOutputKindSchema = responseObject({
  kind: z.string(),
  label: z.string(),
  refinements: z.array(z.string()),
  next: z.array(responseObject({ workflow_id: z.string(), prompt: z.string() })),
});

export const agentSkillCatalogSchema = responseObject({
  skills: z.array(agentSkillSchema),
  workflows: z.array(agentWorkflowSchema).default([]),
  output_kinds: z.array(agentOutputKindSchema).default([]),
  models: responseObject({
    options: z.array(responseObject({ id: z.string(), label: z.string() })),
    default_model: z.string(),
    default_reasoning_effort: agentReasoningEffortSchema,
  }),
  limits: responseObject({
    message_max_chars: z.number().int(),
    mentions_max: z.number().int(),
    attachments_max: z.number().int(),
    attachment_max_chars: z.number().int(),
    attachments_total_max_chars: z.number().int(),
  }),
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
  page_snapshot_reference: z.strictObject({ snapshot_id: uuid() }).nullish(),
  prompt_reference: z
    .strictObject({ topic_id: uuid(), prompt_ids: z.array(uuid()).min(1).max(100) })
    .nullish(),
  action_url_ids: z.array(uuid()).min(1).max(50).nullish(),
  url_actions_reference: z.strictObject({ site_url_id: uuid() }).nullish(),
  objection_group_id: uuid().nullish(),
});
export type AgentContextRefs = z.input<typeof agentContextRefsSchema>;

export function agentRequestSchemas(bounds: {
  message_max_chars: number;
  mentions_max: number;
  attachments_max: number;
  attachment_max_chars: number;
  attachments_total_max_chars: number;
  output_title_max_chars: number;
  output_body_max_chars: number;
  instructions_max_chars: number;
}) {
  const message = z.string().max(bounds.message_max_chars).trim().min(1);
  const skill = z.string().max(64).nullish();
  const workflow = z.string().max(64).nullish();
  const model = z.string().max(64).nullish();
  const reasoningEffort = agentReasoningEffortSchema.nullish();
  const mentions = z
    .array(uuid())
    .max(bounds.mentions_max)
    .refine((ids) => new Set(ids).size === ids.length, 'Mentioned Actions must be unique')
    .default([]);
  const attachments = z
    .array(attachmentSchema(z.string().min(1).max(bounds.attachment_max_chars)))
    .max(bounds.attachments_max)
    .refine(
      (items) => attachedChars(items) <= bounds.attachments_total_max_chars,
      `Attachments hold up to ${bounds.attachments_total_max_chars} characters together`,
    )
    .default([]);
  return {
    create: z.strictObject({
      message,
      skill_id: skill,
      workflow_id: workflow,
      action_id: uuid().nullish(),
      context: agentContextRefsSchema.default({}),
      mentions,
      attachments,
      model,
      reasoning_effort: reasoningEffort,
    }),
    message: z.strictObject({
      message,
      skill_id: skill,
      mentions,
      attachments,
      model,
      reasoning_effort: reasoningEffort,
    }),
    edit: z.strictObject({
      base_revision_id: uuid(),
      title: z.string().max(bounds.output_title_max_chars).trim().min(1),
      body: z.string().max(bounds.output_body_max_chars).trim().min(1),
    }),
    instructions: z.strictObject({ text: z.string().max(bounds.instructions_max_chars) }),
    suggestion: z.strictObject({ base_revision_id: uuid() }),
    target: z.strictObject({ decision: z.enum(['link', 'keep']) }),
  };
}
type AgentRequestSchemas = ReturnType<typeof agentRequestSchemas>;
export type AgentChatCreateRequest = z.input<AgentRequestSchemas['create']>;
export type AgentMessageRequest = z.input<AgentRequestSchemas['message']>;
export type AgentOutputEditRequest = z.input<AgentRequestSchemas['edit']>;
export type AgentInstructionsRequest = z.input<AgentRequestSchemas['instructions']>;
export type AgentOutputTargetRequest = z.input<AgentRequestSchemas['target']>;
