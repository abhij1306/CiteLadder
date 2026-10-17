import { z } from 'zod';

import {
  expectedCheckSchema,
  implementationStateSchema,
  opportunitySchema,
  verificationEventSchema,
} from './opportunities.ts';

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);
const uuid = () => z.uuid();

// open → in progress → implemented (declared) → measuring → done | dismissed.
// A user stores `open` or `dismissed` and a declaration stores `implemented`;
// `in_progress`, `measuring` and `done` are derived by the server.
export const actionStatusSchema = z.enum([
  'open',
  'in_progress',
  'implemented',
  'measuring',
  'done',
  'dismissed',
]);

// One unit of work per target, projected from persisted Action rows.
export const actionItemSchema = responseObject({
  id: uuid(),
  project_id: uuid(),
  target_kind: z.string(),
  target_label: z.string(),
  target_url: z.string().nullable(),
  target_prompt_id: uuid().nullable(),
  origin: z.enum(['evidence', 'agent']),
  status: actionStatusSchema,
  priority_score: z.number().nullable(),
  families: z.array(z.string()),
  approach: z.string(),
  skill_id: z.string(),
  member_count: z.number().int(),
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

// The deterministic diagnosis persisted at recompute. An agent-origin Action
// with no evidence yet carries an empty object, so every field is optional.
const actionDiagnosisSchema = responseObject({
  what_happened: z.array(diagnosisMemberSchema).optional(),
  families: z.record(z.string(), z.enum(['observed', 'no_finding', 'unavailable'])).optional(),
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
  // The crawl, audit, traffic snapshot or schedule behind it.
  source_id: uuid().nullable(),
});

// One expected check's latest reading. Each check keeps the state its own
// evidence last gave it, so a crawl and a Search Console window together can
// settle a page Action that neither settles alone.
export const declarationCheckSchema = responseObject({
  index: z.number().int(),
  kind: z.string(),
  leg: measurementLegSchema.shape.leg,
  // `waiting`: no comparable reading yet. `unavailable`: the reading could not
  // answer, with `reason`. `met` / `unmet`: the reading answered.
  state: z.enum(['waiting', 'met', 'unmet', 'unavailable']),
  reason: z.string().nullable(),
  observed_at: z.string().nullable(),
  // The exact source of that reading: a crawl, audit, traffic snapshot or
  // Search Intelligence dataset.
  source_kind: z.string().nullable(),
  source_id: z.string().nullable(),
  // What the check names: a rule, a prompt's text, a page or query, or a link.
  subject: z.string().nullable(),
  // The tracked prompt a visibility check measures, whose history it links to.
  prompt_id: uuid().nullable().optional(),
});

// The user's declaration, frozen server-side: members, targets and checks.
export const actionDeclarationSchema = responseObject({
  id: uuid(),
  action_id: uuid(),
  output_revision_id: uuid().nullable(),
  member_opportunity_ids: z.array(uuid()),
  opportunity_snapshot_id: uuid(),
  target_site_url_ids: z.array(uuid()),
  // Populated instead of the owned ids for an earned Action: the publisher
  // page the listing was requested on. Never both.
  target_external_url: z.string().nullable(),
  declared_implemented_at: z.string(),
  expected_checks: z.array(expectedCheckSchema),
  state: implementationStateSchema,
  limitations: z.array(z.string()),
  verification_events: z.array(verificationEventSchema),
  legs: z.array(measurementLegSchema),
  checks: z.array(declarationCheckSchema),
  // When new evidence stops re-checking this declaration.
  measured_until: z.string(),
  created_at: z.string(),
});

export const actionDetailSchema = actionItemSchema.extend({
  // Per member opportunity id: the reading that would measure it once
  // declared, or null when no automatic check applies.
  member_measurement: z.record(z.string(), measurementLegSchema.shape.leg.nullable()),
  // The earliest implementation time a declaration accepts.
  declarable_since: z.string(),
  diagnosis: actionDiagnosisSchema,
  // Each live finding with what to do about it.
  members: z.array(opportunitySchema.extend({ remediation: z.string() })),
  declaration: actionDeclarationSchema.nullable(),
});

export const actionsPageSchema = responseObject({
  items: z.array(actionItemSchema),
  next_cursor: z.string().nullable(),
  status_counts: z.record(z.string(), z.number().int()),
});
