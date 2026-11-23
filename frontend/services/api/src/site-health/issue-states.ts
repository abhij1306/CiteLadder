import { randomUUID } from 'node:crypto';
import { sql, type Insertable, type Selectable } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { subjectXactLock } from '../db/advisory-lock.ts';
import type { SiteIssueStates } from '../generated/db-schema.ts';
import { eachPageAuditBatch, type PageAudit } from './issue-audits.ts';
import type { Crawl } from './site-task.ts';

const config = policy.site_health.reads.issue_states;
const UNAVAILABLE_RULES = config.unavailable_rules;
const AVAILABILITY_RULES = new Set<string>(Object.values(UNAVAILABLE_RULES));
const RULE_VERSIONS = new Map(
  policy.site_health.rule_catalog.map((rule) => [rule.rule_id, rule.rule_version]),
);

type IssueState =
  | 'open'
  | 'marked_fixed'
  | 'resolved'
  | 'regressed'
  | 'page_unavailable'
  | 'no_longer_tracked';

type StateRow = Selectable<SiteIssueStates>;
type Source = {
  analysisId: string | null;
  attemptId: string | null;
  evaluationId: string | null;
  issueId: string | null;
};
type Landing = {
  crawlId: string;
  auditAt: Date;
  analyzerVersion: string;
  now: Date;
};
type Scope = { workspaceId: string; projectId: string };

const isResolved = (state: string) => state === 'resolved';
const SUSPENDED = new Set<string>(['page_unavailable', 'no_longer_tracked']);

const NO_SOURCE: Source = {
  analysisId: null,
  attemptId: null,
  evaluationId: null,
  issueId: null,
};

function pageStates(
  scope: Scope,
  siteUrlId: string,
  existing: readonly StateRow[],
  landing: Landing,
) {
  const byRule = new Map(existing.map((row) => [row.rule_id, row]));
  const rows: Insertable<SiteIssueStates>[] = [];
  const write = (
    ruleId: string,
    state: IssueState,
    source: Source,
    extra: {
      ruleVersion?: string;
      evidence?: Record<string, unknown> | null;
      seen?: boolean;
    },
  ) => {
    const prior = byRule.get(ruleId);
    const at = landing.auditAt;
    rows.push({
      id: prior?.id ?? randomUUID(),
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      site_url_id: siteUrlId,
      rule_id: ruleId,
      state,
      first_seen_at: prior?.first_seen_at ?? at,
      last_seen_at: extra.seen ? at : (prior?.last_seen_at ?? at),
      resolved_at: state === 'resolved' ? at : null,
      marked_fixed_at: prior?.marked_fixed_at ?? null,
      last_audit_at: at,
      source_crawl_id: landing.crawlId,
      source_analysis_id: source.analysisId,
      source_attempt_id: source.attemptId,
      source_evaluation_id: source.evaluationId,
      source_issue_id: source.issueId ?? prior?.source_issue_id ?? null,
      evidence:
        extra.evidence === undefined
          ? (prior?.evidence ?? null)
          : extra.evidence && JSON.stringify(extra.evidence),
      rule_version: extra.ruleVersion ?? prior?.rule_version ?? RULE_VERSIONS.get(ruleId) ?? '',
      analyzer_version: landing.analyzerVersion,
      policy_version: config.policy_version,
      created_at: prior?.created_at ?? landing.now,
      updated_at: landing.now,
    });
  };
  const found = (ruleId: string): IssueState => {
    const prior = byRule.get(ruleId);
    if (
      prior?.state === 'marked_fixed' &&
      prior.marked_fixed_at &&
      prior.marked_fixed_at > landing.auditAt
    )
      return 'marked_fixed';
    return prior?.state === 'resolved' || prior?.state === 'regressed' ? 'regressed' : 'open';
  };
  const resolve = (ruleId: string, source: Source, ruleVersion?: string) => {
    const prior = byRule.get(ruleId);
    if (prior && !isResolved(prior.state)) write(ruleId, 'resolved', source, { ruleVersion });
  };
  return { rows, write, found, resolve };
}

function nextIssueStates(
  scope: Scope,
  audit: PageAudit,
  existing: readonly StateRow[],
  landing: Landing,
): Insertable<SiteIssueStates>[] {
  const states = pageStates(scope, audit.siteUrlId, existing, landing);
  if (audit.kind === 'analyzed') analyzedStates(states, audit, existing);
  else unavailableStates(states, audit, existing);
  return states.rows;
}

type PageStates = ReturnType<typeof pageStates>;
type Analyzed = Extract<PageAudit, { kind: 'analyzed' }>;
type Unavailable = Extract<PageAudit, { kind: 'unavailable' }>;

function analyzedStates(
  { write, found, resolve }: PageStates,
  audit: Analyzed,
  existing: readonly StateRow[],
) {
  const page = { ...NO_SOURCE, analysisId: audit.analysisId };
  for (const [ruleId, finding] of audit.found)
    write(
      ruleId,
      found(ruleId),
      { ...page, evaluationId: finding.evaluationId, issueId: finding.issueId },
      { ruleVersion: finding.ruleVersion, seen: true },
    );
  for (const [ruleId, passed] of audit.passed)
    if (!audit.found.has(ruleId))
      resolve(ruleId, { ...page, evaluationId: passed.evaluationId }, passed.ruleVersion);
  for (const ruleId of AVAILABILITY_RULES) resolve(ruleId, page);
  const judged = (ruleId: string) => audit.found.has(ruleId) || audit.passed.has(ruleId);
  for (const prior of existing)
    if (SUSPENDED.has(prior.state) && !judged(prior.rule_id))
      write(prior.rule_id, 'open', page, {});
}

function unavailableStates(
  { write, found, resolve }: PageStates,
  audit: Unavailable,
  existing: readonly StateRow[],
) {
  const source = { ...NO_SOURCE, analysisId: audit.analysisId, attemptId: audit.attemptId };
  const ruleId = UNAVAILABLE_RULES[audit.reason];
  write(ruleId, found(ruleId), source, { evidence: audit.evidence, seen: true });
  for (const other of AVAILABILITY_RULES) if (other !== ruleId) resolve(other, source);
  for (const prior of existing)
    if (
      !AVAILABILITY_RULES.has(prior.rule_id) &&
      !isResolved(prior.state) &&
      prior.state !== 'page_unavailable'
    )
      write(prior.rule_id, 'page_unavailable', source, {});
}

const auditTime = (crawl: Crawl) => new Date(crawl.started_at ?? crawl.created_at);

async function newerAudited(db: Database, crawl: Crawl, pageIds: string[], auditAt: Date) {
  const rows = await db
    .selectFrom('site_page_analyses as a')
    .innerJoin('site_crawls as c', (join) =>
      join.onRef('c.id', '=', 'a.crawl_id').onRef('c.workspace_id', '=', 'a.workspace_id'),
    )
    .select('a.site_url_id')
    .distinct()
    .where('a.workspace_id', '=', crawl.workspace_id)
    .where('a.project_id', '=', crawl.project_id)
    .where('a.site_url_id', '=', sql<string>`any(${pageIds}::uuid[])`)
    .where('a.crawl_id', '!=', crawl.id)
    .where('a.is_current', '=', true)
    .where('a.finalized_at', 'is not', null)
    .where(sql<boolean>`coalesce(c.started_at, c.created_at) > ${auditAt}`)
    .execute();
  return new Set(rows.map((row) => row.site_url_id));
}

export async function landIssueStates(db: Database, crawl: Crawl): Promise<void> {
  const scope = {
    workspaceId: crawl.workspace_id,
    projectId: crawl.project_id,
  };
  const now = new Date();
  const landing = {
    crawlId: crawl.id,
    auditAt: auditTime(crawl),
    analyzerVersion: crawl.analyzer_version || policy.site_health.versions.analyzer,
    now,
  };
  let landed = false;
  await eachPageAuditBatch(db, crawl, async (audits) => {
    if (!audits.length) return;
    if (!landed) await lockIssueStates(db, scope);
    landed = true;
    await landAuditBatch(db, { crawl, scope, landing, audits });
  });
  if (!landed) return;
  await releaseUntrackedStates(db, scope, now);
  await writeTrendPoint(db, crawl, now);
}

async function landAuditBatch(
  db: Database,
  batch: { crawl: Crawl; scope: Scope; landing: Landing; audits: PageAudit[] },
) {
  const { crawl, scope, landing, audits } = batch;
  const auditAt = landing.auditAt;
  const pageIds = audits.map((audit) => audit.siteUrlId);
  const existing = await db
    .selectFrom('site_issue_states')
    .selectAll()
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('site_url_id', '=', sql<string>`any(${pageIds}::uuid[])`)
    .execute();
  const byPage = new Map<string, StateRow[]>();
  for (const row of existing)
    byPage.set(row.site_url_id, [...(byPage.get(row.site_url_id) ?? []), row]);
  const newer = await newerAudited(db, crawl, pageIds, auditAt);
  const rows = audits.flatMap((audit) => {
    const states = byPage.get(audit.siteUrlId) ?? [];
    if (newer.has(audit.siteUrlId) || states.some((row) => row.last_audit_at > auditAt)) return [];
    return nextIssueStates(scope, audit, states, landing);
  });
  const chunk = Math.floor(65_535 / Object.keys(rows[0] ?? { id: '' }).length);
  for (let offset = 0; offset < rows.length; offset += chunk)
    await db // NOSONAR
      .insertInto('site_issue_states')
      .values(rows.slice(offset, offset + chunk))
      .onConflict((conflict) =>
        conflict
          .columns(['workspace_id', 'project_id', 'site_url_id', 'rule_id'])
          .doUpdateSet((eb) => ({
            state: eb.ref('excluded.state'),
            last_seen_at: eb.ref('excluded.last_seen_at'),
            resolved_at: eb.ref('excluded.resolved_at'),
            last_audit_at: eb.ref('excluded.last_audit_at'),
            source_crawl_id: eb.ref('excluded.source_crawl_id'),
            source_analysis_id: eb.ref('excluded.source_analysis_id'),
            source_attempt_id: eb.ref('excluded.source_attempt_id'),
            source_evaluation_id: eb.ref('excluded.source_evaluation_id'),
            source_issue_id: eb.ref('excluded.source_issue_id'),
            evidence: eb.ref('excluded.evidence'),
            rule_version: eb.ref('excluded.rule_version'),
            analyzer_version: eb.ref('excluded.analyzer_version'),
            policy_version: eb.ref('excluded.policy_version'),
            updated_at: eb.ref('excluded.updated_at'),
          }))
          .where((eb) =>
            eb('site_issue_states.last_audit_at', '<=', eb.ref('excluded.last_audit_at')),
          ),
      )
      .execute();
}

/**
 * A page whose membership left the set (a lowered limit, `fitTrackedSet`) is
 * never audited again, so its unresolved issues read `no_longer_tracked`, never
 * resolved, and leave the open count. A page tracked again returns to `open`
 * when an audit lands on it (`analyzedStates`). Not an audit: the deciding
 * sources and audit time stay the page's last audit's.
 */
async function releaseUntrackedStates(db: Database, scope: Scope, now: Date) {
  await db
    .updateTable('site_issue_states as s')
    .set({ state: 'no_longer_tracked', updated_at: now })
    .where('s.workspace_id', '=', scope.workspaceId)
    .where('s.project_id', '=', scope.projectId)
    .where('s.state', 'not in', ['resolved', 'no_longer_tracked'])
    .where(
      sql<boolean>`exists (
        select 1 from monitored_site_urls m
        where m.workspace_id = s.workspace_id and m.project_id = s.project_id
          and m.site_url_id = s.site_url_id and not m.active)`,
    )
    .execute();
}

const lockIssueStates = (db: Database, scope: Scope) =>
  subjectXactLock(db, `site-issue-states:${scope.workspaceId}:${scope.projectId}`);

export async function markIssueFixed(
  db: Database,
  scope: Scope & { ruleId: string; siteUrlIds: readonly string[] },
): Promise<string[]> {
  if (!scope.siteUrlIds.length) return [];
  await lockIssueStates(db, scope);
  const now = new Date();
  const rows = await db
    .updateTable('site_issue_states')
    .set({ state: 'marked_fixed', marked_fixed_at: now, updated_at: now })
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('rule_id', '=', scope.ruleId)
    .where('site_url_id', '=', sql<string>`any(${scope.siteUrlIds}::uuid[])`)
    .where('state', 'in', ['open', 'regressed'])
    .returning('site_url_id')
    .execute();
  return rows.map((row) => row.site_url_id);
}

async function writeTrendPoint(db: Database, crawl: Crawl, now: Date) {
  await sql`
    insert into site_issue_trend
      (id, workspace_id, project_id, day, open_count, source_crawl_id, policy_version,
       created_at, updated_at)
    select ${randomUUID()}, ${crawl.workspace_id}, ${crawl.project_id},
      (${now}::timestamptz at time zone 'UTC')::date, count(*)::int, ${crawl.id},
      ${config.policy_version}, ${now}, ${now}
    from site_issue_states s
    where s.workspace_id = ${crawl.workspace_id} and s.project_id = ${crawl.project_id}
      and s.state = any(${config.open_states}::text[])
    on conflict (workspace_id, project_id, day) do update set
      open_count = excluded.open_count,
      source_crawl_id = excluded.source_crawl_id,
      policy_version = excluded.policy_version,
      updated_at = excluded.updated_at`.execute(db);
}
