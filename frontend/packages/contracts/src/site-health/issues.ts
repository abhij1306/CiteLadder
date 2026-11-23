import { z } from 'zod';

import { pageKindSchema } from './crawl.ts';
import { responseObject, uuid } from './core.ts';
import { cursorPageSchema } from './pagination.ts';

export const issueSeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info']);
export const issueDimensionSchema = z.enum(['technical', 'aeo']);
export const findingClassSchema = z.enum(['defect', 'diagnostic']);
export const issueSectionSchema = z.enum(['technical', 'content', 'aeo']);
export const issueSortSchema = z.enum(['severity', 'pages']);

const textValue = <Kind extends string>(kind: Kind) =>
  responseObject({ kind: z.literal(kind), text: z.string(), length: z.number().int() });
const countValue = <Kind extends string>(kind: Kind) =>
  responseObject({ kind: z.literal(kind), count: z.number().int() });

export const issueValueSchema = z.discriminatedUnion('kind', [
  responseObject({ kind: z.literal('none') }),
  responseObject({ kind: z.literal('unavailable') }),
  textValue('title'),
  textValue('meta_description'),
  countValue('h1_count'),
  countValue('word_count'),
]);

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
  issue_title: z.string(),
  description: z.string(),
  remediation: z.string(),
  reason_code: z.string(),
  evidence: z.record(z.string(), z.unknown()),
  analyzer_version: z.string(),
  rule_version: z.string(),
  created_at: z.string(),
});

export const affectedPageSchema = issueOccurrenceSchema.extend({ value: issueValueSchema });

export const siteIssueSchema = responseObject({
  group_id: uuid(),
  crawl_id: uuid(),
  rule_id: z.string(),
  page_kinds: z.array(z.string()),
  dimension: issueDimensionSchema,
  category: z.string(),
  severity: issueSeveritySchema,
  title: z.string(),
  description: z.string(),
  remediation: z.string(),
  remediation_route: z.string(),
  score_roles: z.array(z.string()),
  affected_url_count: z.number().int(),
  new_url_count: z.number().int().nullable(),
  resolved_url_count: z.number().int().nullable(),
  analyzer_version: z.string(),
  rule_version: z.string(),
  created_at: z.string(),
});

export const issuesSummarySchema = responseObject({
  issue_count: z.number().int(),
  occurrence_count: z.number().int(),
  severity_counts: z.record(z.string(), z.number().int()),
  dimension_counts: z.record(z.string(), z.number().int()),
  affected_url_count: z.number().int(),
  monitored_affected_url_count: z.number().int(),
  section_counts: z.record(issueSectionSchema, z.number().int()),
});

export const siteIssueDetailSchema = responseObject({
  group_id: uuid(),
  crawl_id: uuid(),
  rule_id: z.string(),
  dimension: issueDimensionSchema,
  category: z.string(),
  severity: issueSeveritySchema,
  title: z.string(),
  description: z.string(),
  remediation: z.string(),
  remediation_route: z.string(),
  occurrences: z.array(affectedPageSchema),
  occurrence_count: z.number().int(),
  affected_url_count: z.number().int(),
  analyzer_version: z.string(),
  rule_version: z.string(),
  created_at: z.string(),
  next_cursor: z.string().nullable().optional(),
});

export const siteIssuesPageSchema = cursorPageSchema(siteIssueSchema).extend({
  summary: issuesSummarySchema,
});

export const latestCrawlIssuesPageSchema = siteIssuesPageSchema.extend({ crawl_id: uuid() });

export const issueFixProgressSchema = responseObject({
  group_id: uuid(),
  affected_url_count: z.number().int(),
  fixed_url_count: z.number().int(),
  verified_url_count: z.number().int(),
  rerun_url_count: z.number().int().nullable(),
});

export const issueFixesSchema = responseObject({
  crawl_id: uuid(),
  items: z.array(issueFixProgressSchema),
});

export const issueRerunResponseSchema = responseObject({
  crawl_id: uuid(),
  page_count: z.number().int(),
});

export type IssueFixProgress = z.infer<typeof issueFixProgressSchema>;
export type IssueFixes = z.infer<typeof issueFixesSchema>;
export type IssueRerunResponse = z.infer<typeof issueRerunResponseSchema>;
export type IssueSeverity = z.infer<typeof issueSeveritySchema>;
export type IssueDimension = z.infer<typeof issueDimensionSchema>;
export type IssueSection = z.infer<typeof issueSectionSchema>;
export type IssueSort = z.infer<typeof issueSortSchema>;
export type IssueValue = z.infer<typeof issueValueSchema>;
export type IssueOccurrence = z.infer<typeof issueOccurrenceSchema>;
export type AffectedPage = z.infer<typeof affectedPageSchema>;
export type SiteIssue = z.infer<typeof siteIssueSchema>;
export type SiteIssueDetail = z.infer<typeof siteIssueDetailSchema>;
export type SiteIssuesPage = z.infer<typeof siteIssuesPageSchema>;
export type IssuesSummary = z.infer<typeof issuesSummarySchema>;
