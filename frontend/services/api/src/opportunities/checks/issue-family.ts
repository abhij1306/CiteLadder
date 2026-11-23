import {
  siteIssueFamilyEvidenceSchema,
  type IssueFamilyCohort,
} from '@citeladder/contracts/opportunity-evidence';
import { siteLevelFinding, siteLevelRuleSchema } from '@citeladder/contracts/site-health';
import { sql } from 'kysely';

import { policy } from '../../config.ts';
import { evidencePages } from '../refresh-site-evidence.ts';
import { parseUuid, parseUuids } from '../../http/uuid.ts';
import { ruleTitle } from '../../site-health/reads/rules.ts';
import { compareText } from '../../text-order.ts';
import { outcome, type CheckOutcome } from '../verification-decisions.ts';
import type { CheckModule, MemberFacts } from './kind.ts';
import { latestAudits, once, type ReadContext } from './read-context.ts';

const PASSING = 'satisfied';
const NOT_APPLICABLE = 'not_applicable';
const FAILING = new Set(['missing', 'partial']);
const ANSWERED = new Set([PASSING, NOT_APPLICABLE, ...FAILING]);

export function familyCohort(
  member: Pick<MemberFacts, 'rule_id' | 'evidence'>,
): IssueFamilyCohort | null {
  if (member.rule_id !== policy.opportunity.opportunities.SITE_ISSUE_FAMILY.RULE_ID) return null;
  const parsed = siteIssueFamilyEvidenceSchema.safeParse(member.evidence);
  return parsed.success ? parsed.data.cohort : null;
}

function cohortOf(member: MemberFacts) {
  const cohort = familyCohort(member);
  if (!cohort) return null;
  const crawlId = parseUuid(cohort.crawl_id);
  const ids = parseUuids(cohort.pages.map((page) => page.site_url_id));
  return crawlId && ids.length ? { cohort, crawlId, ids } : null;
}

type CrawlVersions = { analyzer_version: string; rule_catalog_version: string };

function crawlVersions(ctx: ReadContext, crawlId: string) {
  return once(ctx, `crawl-versions:${crawlId}`, () =>
    ctx.scope
      .selectFrom(ctx.db, 'site_crawls')
      .select(['analyzer_version', 'rule_catalog_version'])
      .where('project_id', '=', ctx.declaration.project_id)
      .where('id', '=', crawlId)
      .executeTakeFirst(),
  );
}

const comparable = (left: CrawlVersions, right: CrawlVersions) =>
  left.analyzer_version === right.analyzer_version &&
  left.rule_catalog_version === right.rule_catalog_version;

async function cohortReadings(
  ctx: ReadContext,
  crawlId: string,
  ruleId: string,
  siteUrlIds: readonly string[],
) {
  const d = ctx.declaration;
  const { rows } = await sql<{
    site_url_id: string;
    url: string;
    analysis_id: string;
    evaluation_id: string | null;
    outcome: string | null;
  }>`
    select distinct on (a.site_url_id) a.site_url_id, u.normalized_url as url,
      a.id as analysis_id, e.id as evaluation_id, e.outcome
    from site_page_analyses a
    join site_fetch_artifacts f on f.workspace_id = a.workspace_id and f.id = a.artifact_id
    join site_urls u on u.workspace_id = a.workspace_id and u.id = a.site_url_id
    left join site_rule_evaluations e on e.workspace_id = a.workspace_id
      and e.id = any(a.source_evaluation_ids) and e.rule_id = ${ruleId}
    where a.workspace_id = ${d.workspace_id} and a.project_id = ${d.project_id}
      and a.id in ${await latestAudits(ctx, crawlId, { fold: true })}
      and a.site_url_id = any(${[...siteUrlIds]}::uuid[]) and a.finalized_at is not null
      and f.fetched_at > ${d.declared_implemented_at}::timestamptz
    order by a.site_url_id, a.created_at desc, a.id desc, e.id`.execute(ctx.db);
  return rows;
}

async function readSiteLevel(
  ctx: ReadContext,
  crawlId: string,
  check: { rule_id: string; site_url_ids: string[] },
): Promise<CheckOutcome> {
  const d = ctx.declaration;
  const crawl = await ctx.scope
    .selectFrom(ctx.db, 'site_crawls')
    .select(
      sql<boolean>`coalesce(started_at, created_at) > ${d.declared_implemented_at}::timestamptz`.as(
        'after',
      ),
    )
    .where('project_id', '=', d.project_id)
    .where('id', '=', crawlId)
    .executeTakeFirst();
  const empty = { failing: [], passing: 0, not_applicable: 0, uncovered: 0 };
  const unread = {
    ...outcome(ctx.reading, 'unavailable', 'cohort_not_analyzed'),
    pages: { ...empty, unread: check.site_url_ids.length },
  };
  if (!crawl?.after) return unread;
  const evaluations = await ctx.db
    .selectFrom('site_rule_evaluations as e')
    .innerJoin('site_page_analyses as a', (join) =>
      join.onRef('a.workspace_id', '=', 'e.workspace_id').onRef('a.id', '=', 'e.analysis_id'),
    )
    .select(['e.id', 'e.outcome'])
    .where('e.workspace_id', '=', d.workspace_id)
    .where('a.project_id', '=', d.project_id)
    .where('a.crawl_id', '=', crawlId)
    .where('e.rule_id', '=', check.rule_id)
    .execute();
  const answered = evaluations.filter((row) => ANSWERED.has(row.outcome));
  if (!answered.length) return unread;
  for (const row of answered) ctx.result.rule_evaluation_ids.add(row.id);
  const found = await ctx.scope
    .selectFrom(ctx.db, 'site_issues')
    .select('evidence')
    .where('project_id', '=', d.project_id)
    .where('crawl_id', '=', crawlId)
    .where('rule_id', '=', check.rule_id)
    .where('is_current', '=', true)
    .execute();
  if (!found.length)
    return {
      ...outcome(ctx.reading, 'met'),
      pages: { ...empty, passing: check.site_url_ids.length, unread: 0 },
    };
  const named = new Set(
    found.flatMap((row) => {
      const finding = siteLevelFinding(check.rule_id, row.evidence);
      return finding ? evidencePages(finding).map((page) => page.site_url_id) : [];
    }),
  );
  const still = named.size ? check.site_url_ids.filter((id) => named.has(id)) : check.site_url_ids;
  const urls = await cohortUrls(ctx, still);
  const passing = check.site_url_ids.length - still.length;
  return {
    ...outcome(ctx.reading, 'unmet', passing ? 'partially_resolved' : 'still_failing'),
    pages: { ...empty, failing: urls, passing, unread: 0 },
  };
}

async function cohortUrls(ctx: ReadContext, ids: readonly string[]) {
  if (!ids.length) return [];
  const rows = await ctx.scope
    .selectFrom(ctx.db, 'site_urls')
    .select(['id as site_url_id', 'normalized_url as url'])
    .where('project_id', '=', ctx.declaration.project_id)
    .where('id', 'in', [...ids])
    .execute();
  return rows.sort((left, right) => compareText(left.url, right.url));
}

async function readCohort(
  ctx: ReadContext,
  crawlId: string,
  check: { rule_id: string; baseline_crawl_id: string; site_url_ids: string[]; page_count: number },
): Promise<CheckOutcome> {
  const baseline = await crawlVersions(ctx, check.baseline_crawl_id);
  const current = await crawlVersions(ctx, crawlId);
  if (!baseline) return outcome(ctx.reading, 'unavailable', 'baseline_crawl_unavailable');
  if (!current || !comparable(baseline, current))
    return outcome(ctx.reading, 'unavailable', 'non_comparable_crawl');
  if (siteLevelRuleSchema.safeParse(check.rule_id).success)
    return readSiteLevel(ctx, crawlId, check);
  const readings = await cohortReadings(ctx, crawlId, check.rule_id, check.site_url_ids);
  const answered = readings.filter((row) => row.outcome !== null && ANSWERED.has(row.outcome));
  for (const row of answered) {
    ctx.result.analysis_ids.add(row.analysis_id);
    if (row.evaluation_id) ctx.result.rule_evaluation_ids.add(row.evaluation_id);
  }
  const failing = answered
    .filter((row) => row.outcome !== null && FAILING.has(row.outcome))
    .map((row) => ({ site_url_id: row.site_url_id, url: row.url }))
    .sort((left, right) => compareText(left.url, right.url));
  const passing = answered.filter((row) => row.outcome === PASSING).length;
  const notApplicable = answered.filter((row) => row.outcome === NOT_APPLICABLE).length;
  const cleared = passing + notApplicable;
  const unread = check.site_url_ids.length - answered.length;
  const uncovered = Math.max(0, check.page_count - check.site_url_ids.length);
  const pages = { failing, passing, not_applicable: notApplicable, unread, uncovered };
  if (failing.length)
    return {
      ...outcome(ctx.reading, 'unmet', cleared ? 'partially_resolved' : 'still_failing'),
      pages,
    };
  if (unread)
    return {
      ...outcome(
        ctx.reading,
        'unavailable',
        cleared ? 'cohort_partly_analyzed' : 'cohort_not_analyzed',
      ),
      pages,
    };
  if (uncovered) return { ...outcome(ctx.reading, 'unavailable', 'cohort_sampled'), pages };
  return { ...outcome(ctx.reading, 'met'), pages };
}

export const issueFamilyCheck: CheckModule<'issue_family'> = {
  kind: 'issue_family',
  leg: policy.opportunity.actions.LEG_CRAWL,
  sources: ['site_crawl'],
  measurable: (member) => cohortOf(member) !== null,
  freeze(members) {
    return Promise.resolve(
      members.flatMap((member) => {
        const found = cohortOf(member);
        if (!found) return [];
        return [
          {
            member,
            check: {
              kind: 'issue_family' as const,
              rule_id: found.cohort.rule_id,
              baseline_crawl_id: found.crawlId,
              site_url_ids: found.ids,
              page_count: found.cohort.page_count,
            },
          },
        ];
      }),
    );
  },
  read: (ctx, source, check) => readCohort(ctx, source.id, check),
  subject: (check) => ruleTitle(check.rule_id),
};
