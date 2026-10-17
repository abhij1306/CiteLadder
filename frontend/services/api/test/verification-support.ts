import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Database } from '../src/db/database.ts';
import { policy } from '../src/config.ts';
import { seedOpportunityScenario, actionRow, snapshotRow } from './opportunity-fixtures.ts';

export type VerificationSeed = {
  workspaceId: string;
  projectId: string;
  userId: string;
  auditId: string;
  metricId: string;
  crawlId: string;
  trafficId: string;
  snapshotId: string;
  analysisId: string;
  artifactId: string;
  ruleId: string;
  /** When every source was observed, with PostgreSQL microseconds. */
  moment: string;
  declarations: Record<string, string>;
};

export async function seedVerification(db: Database): Promise<VerificationSeed> {
  // Relative to now, so the verification window always contains the seed;
  // the text keeps microseconds a Date would truncate from the evidence key.
  const { rows } = await sql<{ at: string; day: string }>`
    select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at,
      (t at time zone 'UTC')::date::text as day
    from (select date_trunc('second', now() - interval '2 days') + interval '0.123456 seconds' as t) m
  `.execute(db);
  const clock = rows[0]!;
  const moment = sql<Date>`${clock.at}::timestamptz`;
  const declared = sql<Date>`${moment} - interval '1 day'`;
  const scn = await seedOpportunityScenario(db, false, {
    facts: { secure: true },
    fetchedAt: moment,
  });
  return db.transaction().execute(async (trx) => {
    const scope = { workspace_id: scn.workspace_id, project_id: scn.project_id };
    const snapshot = snapshotRow(scope, {
      audit_id: scn.audit_id,
      source_mix: JSON.stringify({ gap_keys: ['a', 'b'] }),
    });
    await trx
      .insertInto('opportunity_snapshots')
      .values({ ...snapshot, created_at: sql<Date>`${moment} - interval '3 days'` })
      .execute();
    const issue = await trx
      .selectFrom('site_issues')
      .selectAll()
      .where('id', '=', scn.issue_structured_id)
      .executeTakeFirstOrThrow();
    await trx
      .updateTable('site_rule_evaluations')
      .set({ outcome: 'partial' })
      .where('id', '=', issue.evaluation_id)
      .execute();
    await trx
      .updateTable('site_crawls')
      .set({ completed_at: moment })
      .where('id', '=', scn.crawl_id)
      .execute();
    await trx
      .updateTable('audits')
      .set({ completed_at: moment })
      .where('id', '=', scn.audit_id)
      .execute();
    await trx
      .updateTable('metric_snapshots')
      .set({
        created_at: moment,
        visibility_score: 80,
        metrics: JSON.stringify({ per_prompt: [{ prompt_index: 0, composite_score: 80 }] }),
      })
      .where('id', '=', scn.metric_snapshot_id)
      .execute();
    const trafficId = randomUUID();
    await trx
      .insertInto('traffic_snapshots')
      .values({
        ...scope,
        id: trafficId,
        // Starts after the go-live day, which is partly before the change.
        window_start: new Date(`${clock.day}T00:00:00Z`),
        window_end: new Date(`${clock.day}T00:00:00Z`),
        granularity: 'day',
        // Site-wide clicks are high; only the declared page's own row may count.
        metrics: JSON.stringify({ totals: { clicks: 500 } }),
        normalization_version: policy.traffic.TRAFFIC_NORMALIZATION_VERSION,
        formula_version: policy.traffic.TRAFFIC_FORMULA_VERSION,
        created_at: moment,
      })
      .execute();
    await trx
      .insertInto('traffic_page_stats')
      .values({
        ...scope,
        id: randomUUID(),
        snapshot_id: trafficId,
        canonical_url: 'https://acme.test/b',
        site_url_id: null,
        metrics: JSON.stringify({ clicks: 5 }),
        source_metric_row_ids: '[]',
        source_artifact_ids: '[]',
        created_at: new Date(),
      })
      .execute();
    const pageClicks = (url: string) => ({
      kind: 'traffic_metric',
      metric: 'clicks',
      direction: 'increase',
      scope: 'page',
      scope_key: url,
      min_delta: 0.1,
      baseline_value: 1,
      baseline_window_days: 7,
    });
    const siteRule = {
      kind: 'site_rule',
      rule_id: issue.rule_id,
      expected_outcome: 'partial',
      target_site_url_id: issue.site_url_id,
    };
    const checks: Record<string, Record<string, unknown>[]> = {
      site: [siteRule],
      traffic: [pageClicks('https://acme.test/b')],
      // Search Console has no row for this page, whatever the site total says.
      traffic_other: [pageClicks('https://acme.test/elsewhere')],
      visibility: [
        {
          kind: 'visibility_metric',
          metric: 'prompt_score',
          target_prompt_id: scn.prompt0_id,
          baseline_value: 40,
          min_delta: 1,
          direction: 'increase',
        },
      ],
      // Declared before checks were prompt-scoped: the project score moved.
      legacy: [
        {
          kind: 'visibility_metric',
          metric: 'visibility_score',
          baseline_value: 40,
          min_delta: 1,
          direction: 'increase',
        },
      ],
      // A crawl and a Search Console window each settle one of its checks.
      mixed: [siteRule, pageClicks('https://acme.test/b')],
      // Went live before the verification window; no new source re-reads it.
      expired: [siteRule],
      missing_prompt: [
        {
          kind: 'visibility_metric',
          target_prompt_id: randomUUID(),
          baseline_value: 40,
          min_delta: 1,
          direction: 'increase',
        },
      ],
      // An earned listing is measured on the prompts that cited the page.
      earned: [
        {
          kind: 'visibility_metric',
          metric: 'prompt_score',
          target_prompt_id: scn.prompt0_id,
          baseline_value: 40,
          min_delta: 1,
          direction: 'increase',
        },
      ],
    };
    const declarations: Record<string, string> = {};
    for (const [name, expected] of Object.entries(checks)) {
      const action = actionRow(scope, {
        group_key: `verification:${name}`,
        target_kind: 'page',
        target_label: name,
        status: 'implemented',
      });
      await trx.insertInto('actions').values(action).execute();
      const id = randomUUID();
      await trx
        .insertInto('opportunity_implementation_events')
        .values({
          ...scope,
          id,
          action_id: action.id,
          opportunity_snapshot_id: snapshot.id,
          actor_user_id: scn.user_id,
          declared_implemented_at:
            name === 'expired' ? sql<Date>`${moment} - interval '40 days'` : declared,
          target_site_url_ids: JSON.stringify(
            ['site', 'mixed', 'expired'].includes(name) ? [issue.site_url_id] : [],
          ),
          target_external_url: name === 'earned' ? 'https://publisher.test/list' : null,
          expected_checks: JSON.stringify(expected),
          member_opportunity_ids: '[]',
          idempotency_key: name,
          request_fingerprint: name,
          created_at: declared,
        })
        .execute();
      declarations[name] = id;
    }
    return {
      workspaceId: scn.workspace_id,
      projectId: scn.project_id,
      userId: scn.user_id,
      auditId: scn.audit_id,
      metricId: scn.metric_snapshot_id,
      crawlId: scn.crawl_id,
      trafficId,
      snapshotId: snapshot.id,
      analysisId: issue.analysis_id,
      artifactId: issue.source_artifact_id,
      ruleId: issue.evaluation_id,
      moment: clock.at,
      declarations,
    };
  });
}
