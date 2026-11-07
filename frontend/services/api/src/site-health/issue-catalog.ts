/**
 * The Issues catalog a crawl's unfiltered read serves, persisted per finding
 * class on `site_issue_catalogs`.
 *
 * It is written wherever the crawl's current issue set changes, in that
 * writer's transaction: every issue-currency refresh (the terminal
 * publication, an analysis appended over a finalized one, a duplicate alias
 * retiring analyses) and the site-level architecture findings. Each write
 * replaces the crawl's rows with the groups and summary computed from the
 * current issues, so the read never recomputes them. The issues stay as
 * written; each row names the crawl and versions it was computed from, and
 * `sources` keeps every group's exact issue and evaluation IDs (never served).
 */
import type { Database } from '../db/database.ts';
import {
  catalogItems,
  catalogSources,
  ISSUE_FINDING_CLASSES,
  issueSummary,
  unfilteredIssues,
} from './reads/issues.ts';
import type { Crawl } from './site-task.ts';

export async function persistIssueCatalog(db: Database, crawl: Crawl): Promise<void> {
  const now = new Date();
  for (const findingClass of ISSUE_FINDING_CLASSES) {
    const filters = unfilteredIssues(findingClass);
    // One transaction connection: the class's two reads, then its write.
    const items = await catalogItems(db, crawl, filters); // NOSONAR -- In order on the writer's connection.
    const summary = await issueSummary(db, crawl, filters); // NOSONAR -- In order on the writer's connection.
    const sources = await catalogSources(db, crawl, findingClass); // NOSONAR -- In order on the writer's connection.
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
          analyzer_version: eb.ref('excluded.analyzer_version'),
          rule_catalog_version: eb.ref('excluded.rule_catalog_version'),
          updated_at: eb.ref('excluded.updated_at'),
        })),
      )
      .execute();
  }
}
