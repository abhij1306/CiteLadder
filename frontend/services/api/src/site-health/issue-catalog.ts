/**
 * The Issues catalog a crawl's unfiltered read serves, persisted per finding
 * class on `site_issue_catalogs`.
 *
 * It is written wherever the crawl's current issue set changes, in that
 * writer's transaction: every issue-currency refresh (the terminal
 * publication, an analysis appended over a finalized one, a duplicate alias
 * retiring analyses), the site-level architecture findings, and a page rerun
 * landing in the site crawl that shows it (`issue-currency.ts`). Each write
 * replaces the crawl's rows with the groups and summary computed from the
 * issues the crawl shows (each page's latest audit, `viewIssuesSql`), so the
 * read never recomputes them. The issues stay as
 * written; each row names the crawl and versions it was computed from, and
 * `sources` keeps every group's exact issue and evaluation IDs (never served).
 *
 * `reference_snippets` keeps at most one redacted HTML reference snippet per
 * issue family: from the first affected page in URL order whose fetched facts
 * carry one. Pages keep theirs only in their bounded fetch facts; the Agent's
 * Site Health tool reads the catalog's (`mcp/evidence-site.ts`).
 */
import { sql } from 'kysely';
import { z } from 'zod';

import type { Database } from '../db/database.ts';
import {
  catalogItems,
  catalogSources,
  ISSUE_FINDING_CLASSES,
  issueSummary,
  unfilteredIssues,
} from './reads/issues.ts';
import { viewIssuesSql } from './reads/crawl.ts';
import { issueGroupId } from './reads/rules.ts';
import type { Crawl } from './site-task.ts';

/** Where in a page's fetched facts each issue family's reference snippet is captured. */
const SNIPPET_FACTS: Readonly<Record<string, readonly string[]>> = {
  'web.accessibility_form_names': ['accessibility', 'controls_missing_accessible_name_snippet'],
};

const snippetSchema = z.object({ html: z.string().min(1), truncated: z.boolean() });

export const referenceSnippetSchema = z.object({
  group_id: z.string(),
  rule_id: z.string(),
  page_url: z.string(),
  site_url_id: z.string(),
  issue_id: z.string(),
  source_artifact_id: z.string(),
  html: z.string(),
  truncated: z.boolean(),
});
type IssueReferenceSnippet = z.infer<typeof referenceSnippetSchema>;

/** The family's first affected page, by URL then issue id, whose facts carry a snippet at `path`. */
async function firstSnippetRow(
  db: Database,
  crawl: Crawl,
  family: { findingClass: string; ruleId: string; path: readonly string[] },
) {
  const { rows } = await sql<{
    issue_id: string;
    site_url_id: string;
    source_artifact_id: string;
    page_url: string;
    snippet: unknown;
  }>`
    select i.id as issue_id, i.site_url_id, i.source_artifact_id,
      coalesce(nullif(u.display_url, ''), u.normalized_url) as page_url,
      f.normalized_facts #> ${family.path}::text[] as snippet
    from site_issues i
    join site_urls u on u.workspace_id = i.workspace_id and u.id = i.site_url_id
    join site_fetch_artifacts f on f.workspace_id = i.workspace_id and f.id = i.source_artifact_id
    where ${viewIssuesSql(crawl)}
      and i.finding_class = ${family.findingClass} and i.rule_id = ${family.ruleId}
      and jsonb_typeof(f.normalized_facts #> ${family.path}::text[]) = 'object'
    order by u.normalized_url, i.id limit 1`.execute(db);
  return rows[0];
}

/** Each issue family's one snippet: its first affected page, by URL then issue id, that has one. */
async function referenceSnippets(
  db: Database,
  crawl: Crawl,
  findingClass: string,
): Promise<IssueReferenceSnippet[]> {
  const snippets: IssueReferenceSnippet[] = [];
  for (const [ruleId, path] of Object.entries(SNIPPET_FACTS)) {
    const row = await firstSnippetRow(db, crawl, { findingClass, ruleId, path }); // NOSONAR -- In order on the writer's connection.
    const snippet = snippetSchema.safeParse(row?.snippet);
    if (!row || !snippet.success) continue;
    snippets.push({
      group_id: issueGroupId(crawl.id, ruleId, findingClass),
      rule_id: ruleId,
      page_url: row.page_url,
      site_url_id: row.site_url_id,
      issue_id: row.issue_id,
      source_artifact_id: row.source_artifact_id,
      ...snippet.data,
    });
  }
  return snippets;
}

export async function persistIssueCatalog(db: Database, crawl: Crawl): Promise<void> {
  const now = new Date();
  for (const findingClass of ISSUE_FINDING_CLASSES) {
    const filters = unfilteredIssues(findingClass);
    // One transaction connection: the class's reads, then its write.
    const items = await catalogItems(db, crawl, filters); // NOSONAR -- In order on the writer's connection.
    const summary = await issueSummary(db, crawl, filters); // NOSONAR -- In order on the writer's connection.
    const sources = await catalogSources(db, crawl, findingClass); // NOSONAR -- In order on the writer's connection.
    const snippets = await referenceSnippets(db, crawl, findingClass); // NOSONAR -- In order on the writer's connection.
    await db // NOSONAR -- In order on the writer's connection.
      .insertInto('site_issue_catalogs')
      .values({
        workspace_id: crawl.workspace_id,
        project_id: crawl.project_id,
        crawl_id: crawl.id,
        finding_class: findingClass,
        items: JSON.stringify(items),
        summary: JSON.stringify(summary),
        sources: JSON.stringify(sources),
        reference_snippets: JSON.stringify(snippets),
        analyzer_version: crawl.analyzer_version,
        rule_catalog_version: crawl.rule_catalog_version,
        created_at: now,
        updated_at: now,
      })
      .onConflict((conflict) =>
        conflict.columns(['crawl_id', 'finding_class']).doUpdateSet((eb) => ({
          items: eb.ref('excluded.items'),
          summary: eb.ref('excluded.summary'),
          sources: eb.ref('excluded.sources'),
          reference_snippets: eb.ref('excluded.reference_snippets'),
          analyzer_version: eb.ref('excluded.analyzer_version'),
          rule_catalog_version: eb.ref('excluded.rule_catalog_version'),
          updated_at: eb.ref('excluded.updated_at'),
        })),
      )
      .execute();
  }
}
