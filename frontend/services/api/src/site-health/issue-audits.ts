import { sql } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { failedAs } from './task-outcome.ts';
import type { Crawl } from './site-task.ts';
import { canonicalIdentity } from './url-identity.ts';

const config = policy.site_health.reads.issue_states;
const RESOLVING = new Set<string>(config.resolving_outcomes);
const GONE_STATUSES = policy.site_health.reads.task_outcomes.gone_status_codes;

type Finding = { issueId: string; evaluationId: string; ruleVersion: string };

export type PageAudit =
  | {
      kind: 'analyzed';
      siteUrlId: string;
      analysisId: string;
      found: ReadonlyMap<string, Finding>;
      passed: ReadonlyMap<string, { evaluationId: string; ruleVersion: string }>;
    }
  | {
      kind: 'unavailable';
      siteUrlId: string;
      reason: keyof typeof config.unavailable_rules;
      analysisId: string | null;
      attemptId: string | null;
      evidence: Record<string, unknown>;
    };

function redirected(finalUrl: string, trackedHash: string) {
  try {
    return canonicalIdentity(finalUrl).hash !== trackedHash;
  } catch {
    return false;
  }
}

const batchSize = () => policy.site_health.crawl.finalize.projection_pages;

async function auditedPagesAfter(
  db: Database,
  crawl: Crawl,
  { after, size }: { after: string | null; size: number },
) {
  const { rows } = await sql<{ site_url_id: string }>`
    select p.site_url_id from (
      select a.site_url_id from site_page_analyses a
      where a.workspace_id = ${crawl.workspace_id} and a.crawl_id = ${crawl.id} and a.is_current
        and a.finalized_at is not null and a.status = 'completed'
      union
      select t.site_url_id from site_crawl_tasks t
      where t.workspace_id = ${crawl.workspace_id} and t.crawl_id = ${crawl.id}
        and t.task_kind = 'analyze' and t.status = 'failed' and t.site_url_id is not null
    ) p
    where ${after === null ? sql`true` : sql`p.site_url_id > ${after}::uuid`}
    order by p.site_url_id limit ${size}`.execute(db);
  return rows.map((row) => row.site_url_id);
}

export async function eachPageAuditBatch(
  db: Database,
  crawl: Crawl,
  visit: (audits: PageAudit[]) => Promise<void>,
) {
  const size = batchSize();
  let after: string | null = null;
  for (;;) {
    const ids: string[] = await auditedPagesAfter(db, crawl, { after, size }); // NOSONAR
    if (!ids.length) return;
    await visit(await pageAudits(db, crawl, ids)); // NOSONAR
    const last = ids.at(-1);
    if (!last || ids.length < size) return;
    after = last;
  }
}

async function pageAudits(db: Database, crawl: Crawl, pageIds: string[]): Promise<PageAudit[]> {
  const analyses = await db
    .selectFrom('site_page_analyses as a')
    .innerJoin('site_fetch_artifacts as f', (join) =>
      join.onRef('f.id', '=', 'a.artifact_id').onRef('f.workspace_id', '=', 'a.workspace_id'),
    )
    .innerJoin('site_urls as u', (join) =>
      join.onRef('u.id', '=', 'a.site_url_id').onRef('u.workspace_id', '=', 'a.workspace_id'),
    )
    .select(['a.id', 'a.site_url_id', 'a.source_evaluation_ids', 'f.final_url', 'u.url_hash'])
    .where('a.workspace_id', '=', crawl.workspace_id)
    .where('a.crawl_id', '=', crawl.id)
    .where('a.is_current', '=', true)
    .where('a.finalized_at', 'is not', null)
    .where('a.status', '=', 'completed')
    .where('a.site_url_id', '=', sql<string>`any(${pageIds}::uuid[])`)
    .execute();
  const audits: PageAudit[] = [];
  const analyzed = analyses.filter((row) => {
    if (!redirected(row.final_url, row.url_hash)) return true;
    audits.push({
      kind: 'unavailable',
      siteUrlId: row.site_url_id,
      reason: 'redirect',
      analysisId: row.id,
      attemptId: null,
      evidence: { final_url: row.final_url },
    });
    return false;
  });
  audits.push(
    ...(await analyzedAudits(db, crawl, analyzed)),
    ...(await goneAudits(db, crawl, pageIds)),
  );
  return audits;
}

type AnalysisRow = {
  id: string;
  site_url_id: string;
  source_evaluation_ids: string[] | null;
};

async function analyzedAudits(
  db: Database,
  crawl: Crawl,
  analyses: readonly AnalysisRow[],
): Promise<PageAudit[]> {
  if (!analyses.length) return [];
  const current = new Map(analyses.map((row) => [row.site_url_id, row]));
  const pageIds = [...current.keys()];
  const evaluations = await db
    .selectFrom('site_rule_evaluations as e')
    .innerJoin('site_page_analyses as p', (join) =>
      join.onRef('p.id', '=', 'e.analysis_id').onRef('p.workspace_id', '=', 'e.workspace_id'),
    )
    .select([
      'e.id',
      'e.analysis_id',
      'e.rule_id',
      'e.outcome',
      'e.rule_version',
      'e.source_architecture_id',
      'p.site_url_id',
    ])
    .where('e.workspace_id', '=', crawl.workspace_id)
    .where('p.crawl_id', '=', crawl.id)
    .where('p.site_url_id', '=', sql<string>`any(${pageIds}::uuid[])`)
    .orderBy('e.id')
    .execute();
  const issues = await db
    .selectFrom('site_issues')
    .select(['id', 'site_url_id', 'rule_id', 'evaluation_id', 'rule_version'])
    .where('workspace_id', '=', crawl.workspace_id)
    .where('crawl_id', '=', crawl.id)
    .where('is_current', '=', true)
    .where('site_url_id', '=', sql<string>`any(${pageIds}::uuid[])`)
    .orderBy('id')
    .execute();
  const audits = new Map(
    analyses.map((row) => [
      row.site_url_id,
      {
        kind: 'analyzed' as const,
        siteUrlId: row.site_url_id,
        analysisId: row.id,
        found: new Map<string, Finding>(),
        passed: new Map<string, { evaluationId: string; ruleVersion: string }>(),
      },
    ]),
  );
  for (const issue of issues) {
    const audit = audits.get(issue.site_url_id);
    if (audit && !audit.found.has(issue.rule_id))
      audit.found.set(issue.rule_id, {
        issueId: issue.id,
        evaluationId: issue.evaluation_id,
        ruleVersion: issue.rule_version,
      });
  }
  const namedIds = new Set(analyses.flatMap((row) => row.source_evaluation_ids ?? []));
  for (const row of evaluations) {
    const analysis = current.get(row.site_url_id);
    const audit = audits.get(row.site_url_id);
    const named =
      namedIds.has(row.id) ||
      (row.source_architecture_id !== null && row.analysis_id === analysis?.id);
    if (audit && named && RESOLVING.has(row.outcome))
      audit.passed.set(row.rule_id, {
        evaluationId: row.id,
        ruleVersion: row.rule_version,
      });
  }
  return [...audits.values()];
}

async function goneAudits(db: Database, crawl: Crawl, pageIds: string[]): Promise<PageAudit[]> {
  const rows = await db
    .selectFrom((query) =>
      query
        .selectFrom('site_crawl_tasks')
        .select(['id', 'workspace_id', 'crawl_id', 'site_url_id', 'status', 'error_code'])
        .distinctOn('site_url_id')
        .where('workspace_id', '=', crawl.workspace_id)
        .where('crawl_id', '=', crawl.id)
        .where('task_kind', '=', 'analyze')
        .where('site_url_id', '=', sql<string>`any(${pageIds}::uuid[])`)
        .orderBy('site_url_id')
        .orderBy('generation', 'desc')
        .orderBy('id', 'desc')
        .as('t'),
    )
    .select([
      't.site_url_id',
      sql<string | null>`(select a.id from site_fetch_attempts a
        where a.task_id = t.id and a.workspace_id = t.workspace_id and a.crawl_id = t.crawl_id
          and a.status_code = any(${GONE_STATUSES}::int[])
        order by a.attempt_number desc, a.request_ordinal desc limit 1)`.as('attempt_id'),
      sql<number | null>`(select a.status_code from site_fetch_attempts a
        where a.task_id = t.id and a.workspace_id = t.workspace_id and a.crawl_id = t.crawl_id
          and a.status_code = any(${GONE_STATUSES}::int[])
        order by a.attempt_number desc, a.request_ordinal desc limit 1)`.as('status_code'),
    ])
    .where('t.status', '=', 'failed')
    .where(failedAs('t', ['gone']))
    .where(
      sql<boolean>`not exists (
      select 1 from site_page_analyses p
      where p.workspace_id = t.workspace_id and p.crawl_id = ${crawl.id}
        and p.site_url_id = t.site_url_id and p.is_current and p.finalized_at is not null)`,
    )
    .execute();
  return rows.flatMap((row) =>
    row.site_url_id
      ? [
          {
            kind: 'unavailable' as const,
            siteUrlId: row.site_url_id,
            reason: 'gone' as const,
            analysisId: null,
            attemptId: row.attempt_id,
            evidence: { status_code: row.status_code },
          },
        ]
      : [],
  );
}
