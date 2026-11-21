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
    const selected = await ownedPages(db, action, pages);
    if (!selected.length) return { resolved: false, reason: 'Implementation target is unresolved' };
    return { resolved: true, target_site_url_ids: selected, target_external_url: null };
  },
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
      .select(['completed_at', 'analyzed_url_count'])
      .where('workspace_id', '=', action.workspace_id)
      .where('project_id', '=', action.project_id)
      .where('id', '=', cohort.crawl_id)
      .executeTakeFirst();
    return {
      editable_page: false,
      cohort: {
        ...cohort,
        crawl_completed_at: crawl?.completed_at?.toISOString() ?? null,
        crawl_analyzed_url_count: crawl?.analyzed_url_count ?? null,
      },
    };
  },
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
        pages: pages.map((page) => withoutQuery(page.url)),
        reference_snippet: snippet,
      },
    };
  },
};
