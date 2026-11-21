import { z } from 'zod';

import {
  expectedCheckSchema,
  implementationStateSchema,
  opportunitySchema,
  verificationEventSchema,
} from './opportunities.ts';
import { agentRunSchema } from './agent.ts';
import {
  contentGapFindingEvidenceSchema,
  issueFamilyCohortSchema,
} from './opportunity-evidence.ts';

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);
const uuid = () => z.uuid();

import { actionMeasurementSchema, actionStatusSchema } from './action-status.ts';

export {
  ACTION_STATUS_ANY,
  actionMeasurementSchema,
  actionStatusSchema,
  type ActionMeasurement,
  type ActionStatus,
} from './action-status.ts';

export const actionHandoffSchema = z.discriminatedUnion('context', [
  responseObject({ context: z.literal('action'), message: z.string() }),
  responseObject({
    context: z.literal('opportunity'),
    workflow_id: z.string(),
    opportunity_id: uuid(),
    message: z.string(),
  }),
  responseObject({ context: z.literal('page_url'), workflow_id: z.string(), message: z.string() }),
]);
export type ActionHandoff = z.infer<typeof actionHandoffSchema>;

export const actionGoalSchema = z.enum(['read_site', 'own_pages', 'mentions', 'wrong_claims']);
export type ActionGoal = z.infer<typeof actionGoalSchema>;
export const actionGroupingSchema = z.enum([
  'seo',
  'aeo',
  'content',
  'prompts',
  'create_content',
  'improve_pages',
  'search_queries',
  'internal_links',
  'regressed',
  'product_pages',
  'editorial',
  'ugc',
  'references',
  'other_sources',
]);
export type ActionGrouping = z.infer<typeof actionGroupingSchema>;

export const actionTargetKindSchema = z.enum([
  'page',
  'earned_page',
  'product',
  'category',
  'query',
  'prompt',
  'planned_page',
  'issue_family',
]);
export type ActionTargetKind = z.infer<typeof actionTargetKindSchema>;

export const actionPriorityBandSchema = z.enum(['high', 'medium', 'low']);
export type ActionPriorityBand = z.infer<typeof actionPriorityBandSchema>;

export const actionItemSchema = responseObject({
  id: uuid(),
  project_id: uuid(),
  target_kind: z.string(),
  target_label: z.string(),
  target_url: z.string().nullable(),
  target_prompt_id: uuid().nullable(),
  origin: z.enum(['evidence', 'agent']),
  status: actionStatusSchema,
  measurement: actionMeasurementSchema.nullable(),
  priority_score: z.number().nullable(),
  priority_band: actionPriorityBandSchema.nullable(),
  families: z.array(z.string()),
  approach: z.string(),
  goal: actionGoalSchema,
  grouping: actionGroupingSchema,
  skill_id: z.string(),
  member_count: z.number().int(),
  declarable_member_count: z.number().int(),
  page_count: z.number().int().nullable().default(null),
  finding_class: z.enum(['defect', 'advisory']).nullable().default(null),
  summary: z.string().nullable().default(null),
  handoff: actionHandoffSchema,
  evidence_cleared_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const diagnosisMemberSchema = responseObject({
  opportunity_id: uuid(),
  rule_id: z.string(),
  title: z.string(),
  family: z.string(),
  priority_score: z.number(),
});

const actionDiagnosisSchema = responseObject({
  what_happened: z.array(diagnosisMemberSchema).optional(),
  approach: z.string().optional(),
  skill_id: z.string().optional(),
  donts: z.array(z.string()).optional(),
  measure_with: z.array(z.string()).optional(),
});

// What one loop leg of a declared Action is waiting for.
export const measurementLegSchema = responseObject({
  leg: z.enum(['next_visibility_run', 'next_search_console_window', 'next_crawl']),
  state: z.enum(['waiting', 'not_scheduled', 'sync_needed', 'observed']),
  due_at: z.string().nullable(),
  last_evidence_at: z.string().nullable(),
  source_id: uuid().nullable(),
});

export const issueFamilyPagesSchema = responseObject({
  failing: z.array(responseObject({ site_url_id: uuid(), url: z.string() })),
  passing: z.number().int(),
  not_applicable: z.number().int(),
  unread: z.number().int(),
  uncovered: z.number().int(),
});

export const declarationCheckSchema = responseObject({
  index: z.number().int(),
  kind: z.string(),
  leg: measurementLegSchema.shape.leg,
  state: z.enum(['waiting', 'met', 'unmet', 'unavailable']),
  reason: z.string().nullable(),
  observed_at: z.string().nullable(),
  source_kind: z.string().nullable(),
  source_id: z.string().nullable(),
  subject: z.string().nullable(),
  prompt_id: uuid().nullable().optional(),
  pages: issueFamilyPagesSchema.nullable().optional(),
});

export const actionDeclarationSchema = responseObject({
  id: uuid(),
  action_id: uuid(),
  output_revision_id: uuid().nullable(),
  member_opportunity_ids: z.array(uuid()),
  opportunity_snapshot_id: uuid().nullable(),
  resolved_before_snapshot_id: uuid().nullable(),
  target_site_url_ids: z.array(uuid()),
  target_external_url: z.string().nullable(),
  declared_implemented_at: z.string(),
  deployed_by: z.string().nullable().default(null),
  deployment_reference: z.string().nullable().default(null),
  expected_checks: z.array(expectedCheckSchema),
  state: implementationStateSchema,
  limitations: z.array(z.string()),
  verification_events: z.array(verificationEventSchema),
  legs: z.array(measurementLegSchema),
  checks: z.array(declarationCheckSchema),
  measured_until: z.string(),
  created_at: z.string(),
});

export const actionUrlSchema = responseObject({
  site_url_id: uuid(),
  url: z.string(),
  page_kind: z.string().nullable(),
  open_action_count: z.number().int(),
});

export const actionUrlsPageSchema = responseObject({
  whole_site: z.boolean(),
  total: z.number().int(),
  items: z.array(actionUrlSchema),
  next_cursor: z.string().nullable(),
});

export const actionDetailSchema = actionItemSchema.extend({
  member_measurement: z.record(z.string(), measurementLegSchema.shape.leg.nullable()),
  declarable_since: z.string(),
  diagnosis: actionDiagnosisSchema,
  members: z.array(
    opportunitySchema.extend({
      remediation: z.string(),
      content_gap_evidence: contentGapFindingEvidenceSchema.nullable(),
    }),
  ),
  declaration: actionDeclarationSchema.nullable(),
  editable_page: z.boolean().default(false),
  cohort: issueFamilyCohortSchema
    .omit({ pages: true })
    .extend({
      crawl_completed_at: z.string().nullable(),
      crawl_analyzed_url_count: z.number().int().nullable().default(null),
    })
    .nullable()
    .default(null),
  urls: actionUrlsPageSchema.default({ whole_site: false, total: 0, items: [], next_cursor: null }),
});

export const actionTreeGroupBySchema = z.enum([
  'goal',
  'what_to_do',
  'impact',
  'ownership',
  'topic',
]);
export type ActionTreeGroupBy = z.infer<typeof actionTreeGroupBySchema>;
export const actionOwnershipSchema = z.enum(['owned', 'earned']);

export const actionTreeSchema = responseObject({
  group_by: actionTreeGroupBySchema,
  status_counts: z.record(z.string(), z.number().int()),
  goals: z.array(
    responseObject({ goal: actionGoalSchema, count: z.number().int(), blocking: z.boolean() }),
  ),
  groups: z.array(
    responseObject({
      key: z.string(),
      count: z.number().int(),
      groupings: z.array(
        responseObject({
          grouping: actionGroupingSchema,
          count: z.number().int(),
          items: z.array(actionItemSchema),
          next_cursor: z.string().nullable(),
        }),
      ),
    }),
  ),
});
export type ActionTree = z.infer<typeof actionTreeSchema>;

export const urlActionsSchema = responseObject({
  site_url_id: uuid(),
  url: z.string(),
  page_kind: z.string().nullable(),
  last_crawled_at: z.string(),
  items: z.array(actionItemSchema),
});

export const actionsPageSchema = responseObject({
  items: z.array(actionItemSchema),
  next_cursor: z.string().nullable(),
  status_counts: z.record(z.string(), z.number().int()),
});

export const actionUserStatusSchema = actionStatusSchema.extract([
  'open',
  'in_progress',
  'dismissed',
]);
export type ActionUserStatus = z.infer<typeof actionUserStatusSchema>;

export const actionStatusUpdateRequestSchema = z.strictObject({ status: actionUserStatusSchema });
export type ActionStatusUpdateRequest = z.input<typeof actionStatusUpdateRequestSchema>;

export const ACTION_TOPIC_MAX_CHARS = 255;

export const actionBulkFilterSchema = z.strictObject({
  status: actionStatusSchema,
  q: z.string().max(200).optional(),
  target_kind: actionTargetKindSchema.optional(),
  approach: z.string().optional(),
  priority: actionPriorityBandSchema.optional(),
  family: z.string().optional(),
  grouping: actionGroupingSchema.optional(),
  ownership: actionOwnershipSchema.optional(),
  topic: z.string().max(ACTION_TOPIC_MAX_CHARS).optional(),
});

export const ACTION_BULK_MAX = 100;
export const actionBulkStatusRequestSchema = z
  .strictObject({
    ids: z.array(uuid()).min(1).max(ACTION_BULK_MAX).optional(),
    filter: actionBulkFilterSchema.optional(),
    to: actionUserStatusSchema,
  })
  .refine((body) => (body.ids === undefined) !== (body.filter === undefined), {
    message: 'Name either ids or a filter',
  });
export type ActionBulkStatusRequest = z.input<typeof actionBulkStatusRequestSchema>;

export const actionBulkStatusResultSchema = responseObject({
  updated: z.number().int(),
  skipped: z.number().int(),
  truncated: z.boolean(),
});

export const actionDeclarationRequestSchema = z.strictObject({
  recommendation_ids: z.array(uuid()).max(100).default([]),
  output_revision_id: uuid().nullable().default(null),
  declared_implemented_at: z.iso
    .datetime({ offset: true })
    .refine((value) => !value.startsWith('0000-'), 'A valid calendar year is required'),
  // What shipped it: a release, pull request or commit. One line without
  // control characters (PostgreSQL text cannot store NUL), at most 500
  // characters once trimmed; blank records none.
  deployment_reference: z
    .string()
    .trim()
    .max(500)
    .regex(/^\P{Cc}*$/u, 'Use one line of text')
    .nullable()
    .default(null),
});
export type ActionDeclarationRequest = z.input<typeof actionDeclarationRequestSchema>;

export const analyzablePagesSchema = responseObject({
  crawl_id: uuid().nullable(),
  items: z.array(
    responseObject({
      site_url_id: uuid(),
      url: z.string(),
      title: z.string(),
      page_kind: z.string(),
    }),
  ),
  truncated: z.boolean(),
});

export const actionAnalyzeRequestSchema = z.strictObject({
  site_url_id: uuid(),
  topic_id: uuid(),
  prompt_ids: z
    .array(uuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'Choose each prompt once'),
});
export type ActionAnalyzeRequest = z.input<typeof actionAnalyzeRequestSchema>;

export const actionAnalyzeResultSchema = responseObject({
  action_id: uuid(),
  chat_id: uuid(),
  run: agentRunSchema.nullable(),
});
