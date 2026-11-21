import { issueHistoryPageSchema } from '@citeladder/contracts/site-health';
import { sql } from 'kysely';

import type { Database } from '../../db/database.ts';
import { storedInstant, utcTextOf } from '../../db/timestamps.ts';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../../http/keyset-cursor.ts';
import { parseUuid } from '../../http/uuid.ts';
import { loadCrawl, pageAuditsSql } from './crawl.ts';
import type { Paging } from './issues.ts';
import { shownIssueFilter } from './page-rows.ts';
import { requireAdmitted } from './pages.ts';
import { ruleTitle, type IssueRow } from './rules.ts';

export async function issueHistory(
  db: Database,
  workspaceId: string,
  crawlId: string,
  siteUrlId: string,
  paging: Paging,
) {
  const crawl = await loadCrawl(db, workspaceId, crawlId);
  await requireAdmitted(db, crawl, siteUrlId);
  const { rows: latest } = await sql<{ id: string }>`
    select a.id from (${pageAuditsSql(crawl, sql`${siteUrlId}::uuid`)}) v
    join site_page_analyses a on a.id = v.analysis_id and a.workspace_id = ${workspaceId}
    where a.finalized_at is not null`.execute(db);
  const finalized = latest[0];
  if (!finalized)
    return issueHistoryPageSchema.parse({
      items: [],
      next_cursor: null,
      current_analysis_finalized: false,
    });
  const fingerprint = { site_url_id: siteUrlId, project_id: crawl.project_id, crawl_id: crawl.id };
  let after = sql``;
  if (paging.cursor) {
    const [created, raw, ...rest] = decodeKeysetCursor(paging.cursor, 'issue_history', fingerprint);
    const id = parseUuid(raw);
    if (!created || !/^\d{4}-\d{2}-\d{2}T[\d:.]+$/u.test(created) || id === null || rest.length)
      throw new InvalidCursorError('invalid cursor');
    after = sql`and (r.created_at, r.id) < (${storedInstant(created)}, ${id}::uuid)`;
  }
  const { rows } = await sql<IssueRow & { created_text: string }>`
    with resolved as (
      select distinct on (i.rule_id) i.*
      from site_issues i
      join site_crawls c on c.id = i.crawl_id and c.workspace_id = i.workspace_id
      -- The page's latest audit as the selected crawl shows it, and its crawl.
      join site_page_analyses cur on cur.id = ${finalized.id} and cur.workspace_id = i.workspace_id
      join site_crawls audited on audited.id = cur.crawl_id and audited.workspace_id = i.workspace_id
      where i.workspace_id = ${workspaceId} and i.project_id = ${crawl.project_id}
        and i.site_url_id = ${siteUrlId} and c.project_id = ${crawl.project_id}
        and (coalesce(c.started_at, c.created_at), c.id)
          <= (coalesce(audited.started_at, audited.created_at), audited.id)
        and not exists (
          select 1 from site_issues still_open
          where still_open.workspace_id = ${workspaceId}
            and ${shownIssueFilter(crawl, 'still_open', 'cur')}
            and still_open.rule_id = i.rule_id)
      order by i.rule_id, i.created_at desc, i.id desc
    )
    select r.*, ${utcTextOf(sql.ref('r.created_at'))} as created_text
    from resolved r
    where true ${after}
    order by r.created_at desc, r.id desc limit ${paging.limit + 1}`.execute(db);
  const items = rows.slice(0, paging.limit);
  const last = items.at(-1);
  return issueHistoryPageSchema.parse({
    current_analysis_finalized: true,
    items: items.map((issue) => ({
      id: issue.id,
      crawl_id: issue.crawl_id,
      rule_id: issue.rule_id,
      dimension: issue.dimension,
      category: issue.category,
      severity: issue.severity,
      finding_class: issue.finding_class,
      title: ruleTitle(issue.rule_id),
      description: issue.description,
      remediation: issue.remediation,
      analyzer_version: issue.analyzer_version,
      rule_version: issue.rule_version,
      created_at: issue.created_at.toISOString(),
    })),
    next_cursor:
      rows.length > paging.limit && last
        ? encodeKeysetCursor('issue_history', fingerprint, [last.created_text, last.id])
        : null,
  });
}
