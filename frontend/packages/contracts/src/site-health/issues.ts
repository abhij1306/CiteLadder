import { z } from 'zod';

import { pageKindSchema } from './crawl.ts';
import { responseObject, uuid } from './core.ts';
import { cursorPageSchema } from './pagination.ts';

// Issue severity + dimension enums (config-owned rule catalog).
export const issueSeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info']);
export const issueDimensionSchema = z.enum(['technical', 'aeo']);
export const findingClassSchema = z.enum(['defect', 'advisory', 'diagnostic']);

export const issueOccurrenceSchema = responseObject({
  occurrence_id: uuid(),
  evaluation_id: uuid(),
  crawl_id: uuid(),
  rule_id: z.string(),
  site_url_id: uuid(),
  normalized_url: z.string(),
  display_url: z.string(),
  title: z.string().nullable(),
  page_kind: pageKindSchema.nullable(),
  dimension: issueDimensionSchema,
  category: z.string(),
  severity: issueSeveritySchema,
  finding_class: findingClassSchema,
  issue_title: z.string(),
  description: z.string(),
  remediation: z.string(),
  reason_code: z.string(),
  evidence: z.record(z.string(), z.unknown()),
  analyzer_version: z.string(),
  rule_version: z.string(),
  created_at: z.string(),
});

// One issue catalog row (failure projection with remediation snapshot).
export const siteIssueSchema = responseObject({
  group_id: uuid(),
  crawl_id: uuid(),
  rule_id: z.string(),
  // Page TYPES this group affects. Pack-free page-kind ids, sorted.
  page_kinds: z.array(z.string()),
  dimension: issueDimensionSchema,
  category: z.string(),
  severity: issueSeveritySchema,
  finding_class: findingClassSchema,
  title: z.string(),
  description: z.string(),
  remediation: z.string(),
  // Who can resolve it: `content`, `agent` or `code`.
  remediation_route: z.string(),
  affected_url_count: z.number().int(),
  analyzer_version: z.string(),
  rule_version: z.string(),
  created_at: z.string(),
});

// Grouped-issue catalog summary (occurrence + severity + affected-page counts).
// `severity_counts` keys are the severity vocabulary; `dimension_counts` keys
// are the rule dimensions (technical/aeo); values are occurrence counts.
export const issuesSummarySchema = responseObject({
  issue_count: z.number().int(),
  defect_issue_type_count: z.number().int(),
  advisory_issue_type_count: z.number().int(),
  occurrence_count: z.number().int(),
  severity_counts: z.record(z.string(), z.number().int()),
  dimension_counts: z.record(z.string(), z.number().int()),
  affected_url_count: z.number().int(),
  monitored_affected_url_count: z.number().int(),
});

// Full grouped-issue detail with keyset-paginated persisted occurrences.
// Evidence belongs to each occurrence and its directly linked evaluation.
export const siteIssueDetailSchema = responseObject({
  group_id: uuid(),
  crawl_id: uuid(),
  rule_id: z.string(),
  dimension: issueDimensionSchema,
  category: z.string(),
  severity: issueSeveritySchema,
  finding_class: findingClassSchema,
  title: z.string(),
  description: z.string(),
  remediation: z.string(),
  remediation_route: z.string(),
  occurrences: z.array(issueOccurrenceSchema),
  occurrence_count: z.number().int(),
  affected_url_count: z.number().int(),
  analyzer_version: z.string(),
  rule_version: z.string(),
  created_at: z.string(),
  next_cursor: z.string().nullable().optional(),
});

// Grouped-issue catalog page — cursor page + API-owned summary (mockup 710).
export const siteIssuesPageSchema = cursorPageSchema(siteIssueSchema).extend({
  summary: issuesSummarySchema,
});
