/**
 * One Site Health rule across every owned page it fails on (BL2). The row
 * carries the family's cohort; a declaration covers every cohort page, and an
 * Agent chat gets the family's pages and reference snippet instead of reading
 * each page.
 */
import {
  issueFamilyCohortSchema,
  type IssueFamilyCohort,
} from '@citeladder/contracts/opportunity-evidence';

import type { Json } from '../../agent/contracts.ts';
import { policy } from '../../config.ts';
import { familySnippet, withoutQuery } from '../../mcp/evidence-site.ts';
import { familyCohort } from '../checks/issue-family.ts';
import type { ActionTargetModule, TargetAction } from './kind.ts';
import { ownedPages } from './shared.ts';

const familyPolicy = policy.opportunity.opportunities.SITE_ISSUE_FAMILY;

/** An issue-family Action's stored cohort; null for any other Action. */
export function storedCohort(action: Pick<TargetAction, 'cohort'>): IssueFamilyCohort | null {
  if (action.cohort === null) return null;
  return issueFamilyCohortSchema.parse(action.cohort);
}

export const issueFamilyTarget: ActionTargetModule<'issue_family'> = {
  kind: 'issue_family',
  async declarationTargets({ db, action, members }) {
    const pages = members.flatMap(
      (member) => familyCohort(member)?.pages.map((page) => page.site_url_id) ?? [],
    );
    // The cohort is server-derived and bounded by `COHORT_PAGES_MAX`, so no per-declaration cap.
    const selected = await ownedPages(db, action, pages);
    if (!selected.length) return { resolved: false, reason: 'Implementation target is unresolved' };
    return { resolved: true, target_site_url_ids: selected, target_external_url: null };
  },
  /**
   * The cohort the Action shows: the one its declaration froze (its declared
   * finding's evidence, superseded or not), else the latest refresh's, with
   * when its crawl completed.
   */
  async detail({ db, action, declaredMemberIds }) {
    const declared = declaredMemberIds.length
      ? await db
          .selectFrom('opportunities')
          .select(['id', 'rule_id', 'evidence'])
          .where('workspace_id', '=', action.workspace_id)
          .where('project_id', '=', action.project_id)
          .where('id', 'in', [...declaredMemberIds])
          .execute()
      : [];
    const byId = new Map(declared.map((row) => [row.id, row]));
    const frozen = declaredMemberIds
      .flatMap((id) => {
        const row = byId.get(id);
        return row ? [familyCohort(row)] : [];
      })
      .find((found) => found !== null);
    const cohort = frozen ?? storedCohort(action);
    if (!cohort) return { editable_page: false, cohort: null };
    const crawl = await db
      .selectFrom('site_crawls')
      .select('completed_at')
      .where('workspace_id', '=', action.workspace_id)
      .where('project_id', '=', action.project_id)
      .where('id', '=', cohort.crawl_id)
      .executeTakeFirst();
    return {
      editable_page: false,
      cohort: { ...cohort, crawl_completed_at: crawl?.completed_at?.toISOString() ?? null },
    };
  },
  /**
   * The rule, the affected page count and the first pages of the cohort
   * (without query strings), and the family's one redacted reference snippet
   * from that crawl's catalog, so the Agent writes one fix for the shared cause.
   */
  async agentContext({ db, scope, action }): Promise<Record<string, Json>> {
    const cohort = storedCohort(action);
    if (!cohort) return {};
    const snippet = await familySnippet({ db, scope }, cohort.crawl_id, cohort.rule_id);
    const pages = cohort.pages.slice(0, familyPolicy.AGENT_PAGES_MAX);
    return {
      issue_family: {
        rule_id: cohort.rule_id,
        rule: cohort.rule_label,
        crawl_id: cohort.crawl_id,
        page_count: cohort.page_count,
        // Fewer pages than `page_count`: the rest share the rule and are not listed.
        pages: pages.map((page) => withoutQuery(page.url)),
        reference_snippet: snippet,
      },
    };
  },
};
