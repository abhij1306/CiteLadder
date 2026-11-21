import { isActiveCrawl } from '@citeladder/contracts/site-health';
import { sql } from 'kysely';
import { z } from 'zod';

import type { Database } from '../db/database.ts';
import {
  catalogClassKey,
  catalogItems,
  ISSUE_FINDING_CLASSES,
  issueSummary,
  unfilteredIssues,
} from './reads/issues.ts';
import { viewIssuesSql } from './reads/crawl.ts';
import { issueGroupId } from './reads/rules.ts';
import { CRAWL_COLUMNS, type Crawl } from './site-task.ts';

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
    with affected as materialized (
      select i.id, i.crawl_id, i.site_url_id, i.source_artifact_id, u.normalized_url,
        coalesce(nullif(u.display_url, ''), u.normalized_url) as page_url
      from site_issues i
      join site_urls u on u.workspace_id = i.workspace_id and u.id = i.site_url_id
      where ${viewIssuesSql(crawl)}
        and i.finding_class = ${family.findingClass} and i.rule_id = ${family.ruleId}
    )
    -- The family's pages in URL order, each fetch read only until one carries a
    -- snippet: ordering by URL first drove the plan from every project URL.
    select x.id as issue_id, x.site_url_id, x.source_artifact_id, x.page_url, s.snippet
    from (select * from affected order by normalized_url, id) x
    cross join lateral (
      select f.normalized_facts #> ${family.path}::text[] as snippet
      from site_fetch_artifacts f
      where f.workspace_id = ${crawl.workspace_id} and f.crawl_id = x.crawl_id
        and f.id = x.source_artifact_id
    ) s
    where jsonb_typeof(s.snippet) = 'object'
    order by x.normalized_url, x.id limit 1`.execute(db);
  return rows[0];
}

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

async function computeIssueCatalog(db: Database, crawl: Crawl) {
  const classes = [];
  for (const findingClass of [...ISSUE_FINDING_CLASSES, null]) {
    const filters = unfilteredIssues(findingClass);
    const items = await catalogItems(db, crawl, filters); // NOSONAR -- In order on one connection.
    const summary = await issueSummary(db, crawl, filters); // NOSONAR -- In order on one connection.
    const snippets = findingClass ? await referenceSnippets(db, crawl, findingClass) : []; // NOSONAR -- In order on one connection.
    classes.push({ findingClass, items, summary, snippets });
  }
  return classes;
}

async function writeIssueCatalog(
  db: Database,
  crawl: Crawl,
  classes: Awaited<ReturnType<typeof computeIssueCatalog>>,
) {
  const now = new Date();
  for (const { findingClass, items, summary, snippets } of classes) {
    await db // NOSONAR -- In order on the writer's connection.
      .insertInto('site_issue_catalogs')
      .values({
        workspace_id: crawl.workspace_id,
        project_id: crawl.project_id,
        crawl_id: crawl.id,
        finding_class: catalogClassKey(findingClass),
        items: JSON.stringify(items),
        summary: JSON.stringify(summary),
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
          reference_snippets: eb.ref('excluded.reference_snippets'),
          analyzer_version: eb.ref('excluded.analyzer_version'),
          rule_catalog_version: eb.ref('excluded.rule_catalog_version'),
          updated_at: eb.ref('excluded.updated_at'),
        })),
      )
      .execute();
  }
}

export async function persistIssueCatalog(db: Database, crawl: Crawl): Promise<void> {
  await writeIssueCatalog(db, crawl, await computeIssueCatalog(db, crawl));
}

export async function publishRunningIssues(
  db: Database,
  task: { workspace_id: string; crawl_id: string },
) {
  const crawl = await db
    .selectFrom('site_crawls')
    .select(CRAWL_COLUMNS)
    .where('workspace_id', '=', task.workspace_id)
    .where('id', '=', task.crawl_id)
    .executeTakeFirst();
  if (!crawl || !isActiveCrawl(crawl.status)) return;
  // One connection: the summary's parallel statements never crowd the runner's task slots.
  const classes = await db.connection().execute((conn) => computeIssueCatalog(conn, crawl));
  await db.transaction().execute(async (trx) => {
    const locked = await trx
      .selectFrom('site_crawls')
      .select('status')
      .where('workspace_id', '=', crawl.workspace_id)
      .where('id', '=', crawl.id)
      .forNoKeyUpdate()
      .executeTakeFirst();
    if (locked && isActiveCrawl(locked.status)) await writeIssueCatalog(trx, crawl, classes);
  });
}
