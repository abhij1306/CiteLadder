import { sql, type RawBuilder } from 'kysely';

import type { Database } from '../../db/database.ts';
import { adjacentSiteCrawls, viewIssuesSql, type Crawl } from './crawl.ts';
import { isSiteLevelRule, siteLevelRule } from './rules.ts';

export type IssueChange = { new_url_count: number | null; resolved_url_count: number | null };
type Counts = { rule_id: string; count: number };

const UNKNOWN: IssueChange = { new_url_count: null, resolved_url_count: null };

export async function issueChanges(
  db: Database,
  crawl: Crawl,
  scope: { matching: RawBuilder<unknown>; siteUrlId: string | null; pageKind: string | null },
): Promise<(ruleId: string) => IssueChange> {
  const { previous, next } = await adjacentSiteCrawls(db, crawl);
  if (previous === null) return () => UNKNOWN;
  const since = previous.started_at ?? previous.created_at;
  const before = next ? sql`and s.resolved_at < ${next.started_at ?? next.created_at}` : sql``;
  const page = scope.siteUrlId ? sql`and s.site_url_id = ${scope.siteUrlId}::uuid` : sql``;
  const [fresh, resolved] = await Promise.all([
    sql<Counts>`
      with prior as materialized (
        select distinct p.rule_id, p.site_url_id from site_issues p
        where ${viewIssuesSql(previous, 'p')})
      select i.rule_id, count(distinct i.site_url_id)::int as count
      from site_issues i
      where ${scope.matching} and not ${siteLevelRule}
        and not exists (
          select 1 from prior p where p.rule_id = i.rule_id and p.site_url_id = i.site_url_id)
      group by i.rule_id`.execute(db),
    scope.pageKind
      ? null
      : sql<Counts>`
      select s.rule_id, count(*)::int as count
      from site_issue_states s
      where s.workspace_id = ${crawl.workspace_id} and s.project_id = ${crawl.project_id}
        and s.state = 'resolved' and s.resolved_at > ${since} and s.first_seen_at <= ${since}
        ${before} ${page}
      group by s.rule_id`.execute(db),
  ]);
  const counts = (rows: Counts[]) => new Map(rows.map((row) => [row.rule_id, row.count]));
  const opened = counts(fresh.rows);
  const fixed = resolved ? counts(resolved.rows) : null;
  return (ruleId) =>
    isSiteLevelRule(ruleId)
      ? UNKNOWN
      : {
          new_url_count: opened.get(ruleId) ?? 0,
          resolved_url_count: fixed ? (fixed.get(ruleId) ?? 0) : null,
        };
}
