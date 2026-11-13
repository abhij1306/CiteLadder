import { z } from 'zod';

import { pageKindSchema } from './crawl.ts';
import { responseObject, uuid } from './core.ts';
import { cursorPageSchema } from './pagination.ts';

// Issue severity + dimension enums (config-owned rule catalog).
export const issueSeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info']);
export const issueDimensionSchema = z.enum(['technical', 'aeo']);
export const findingClassSchema = z.enum(['defect', 'advisory', 'diagnostic']);
// The Issues tabs. A rule belongs to exactly one, by the API's category map
// (`reads.issue_section_by_category`), else to its dimension.
export const issueSectionSchema = z.enum(['technical', 'content', 'aeo']);
// Catalog orderings: worst first, or most pages first.
export const issueSortSchema = z.enum(['severity', 'pages']);

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
  // Issue groups per tab under the list's other filters, before the tab
  // narrows it, so every tab label carries its own count.
  section_counts: z.record(issueSectionSchema, z.number().int()),
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

// The same page for the project's newest crawl, named so a reader that did not
// yet know the crawl can file the answer under it.
export const latestCrawlIssuesPageSchema = siteIssuesPageSchema.extend({ crawl_id: uuid() });

// How far an issue's fix has come on the pages the crawl found it on (SH-B12),
// from each page's issue state: "N of M pages fixed". `fixed_url_count`
// counts pages marked fixed or resolved; `verified_url_count` only those an
// audit resolved. `rerun_url_count` is how many tracked, unresolved pages Re-run
// all would re-audit (one page fetch each); null for a site-level finding,
// which only a full crawl judges, so it never reads as "none left".
export const issueFixProgressSchema = responseObject({
  group_id: uuid(),
  affected_url_count: z.number().int(),
  fixed_url_count: z.number().int(),
  verified_url_count: z.number().int(),
  rerun_url_count: z.number().int().nullable(),
});

// Every issue's fix progress in one crawl, one row per issue group.
export const issueFixesSchema = responseObject({
  crawl_id: uuid(),
  items: z.array(issueFixProgressSchema),
});

// Re-run all (202): the re-audit crawl and how many pages it holds fetches for.
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
export type IssueOccurrence = z.infer<typeof issueOccurrenceSchema>;
export type SiteIssue = z.infer<typeof siteIssueSchema>;
export type SiteIssueDetail = z.infer<typeof siteIssueDetailSchema>;
export type SiteIssuesPage = z.infer<typeof siteIssuesPageSchema>;
export type IssuesSummary = z.infer<typeof issuesSummarySchema>;
