/** A declaration's next readings, projected without scheduling or acquiring them. */
import { sql, type Selectable } from 'kysely';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import type {
  OpportunityImplementationEvents,
  OpportunityVerificationEvents,
} from '../generated/db-schema.ts';
import { isoDateText } from '../db/timestamps.ts';
import { record } from '../db/json.ts';

const a = policy.opportunity.actions;
type Declaration = Selectable<OpportunityImplementationEvents>;
type Observation = Selectable<OpportunityVerificationEvents>;
type Leg = {
  leg: string;
  state: string;
  due_at: Date | null;
  last_evidence_at: Date | null;
  source_id: string | null;
};
const empty = (leg: string): Leg => ({
  leg,
  state: a.LEG_STATE_NOT_SCHEDULED,
  due_at: null,
  last_evidence_at: null,
  source_id: null,
});

async function crawlLeg(db: Database, row: Declaration, observations: Observation[]): Promise<Leg> {
  const latest = await db
    .selectFrom('site_crawls')
    .select(['id', 'completed_at'])
    .where('workspace_id', '=', row.workspace_id)
    .where('project_id', '=', row.project_id)
    .where('status', '=', policy.opportunity.refresh.crawl_status_completed)
    .orderBy('completed_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  const observed = observations.findLast((item) => item.crawl_id !== null);
  return {
    ...empty(a.LEG_CRAWL),
    state: observed ? a.LEG_STATE_OBSERVED : a.LEG_STATE_NOT_SCHEDULED,
    last_evidence_at: latest?.completed_at ?? null,
    source_id: observed?.crawl_id ?? latest?.id ?? null,
  };
}

async function visibilityLeg(
  db: Database,
  row: Declaration,
  observations: Observation[],
): Promise<Leg> {
  const audit = observations.findLast((item) => item.audit_id !== null);
  if (audit)
    return {
      ...empty(a.LEG_VISIBILITY_RUN),
      state: a.LEG_STATE_OBSERVED,
      last_evidence_at: audit.observed_at,
      source_id: audit.audit_id,
    };
  const schedule = await db
    .selectFrom('audit_schedules')
    .select(['id', 'next_run_at'])
    .where('workspace_id', '=', row.workspace_id)
    .where('project_id', '=', row.project_id)
    .where('enabled', '=', true)
    .where('next_run_at', 'is not', null)
    .orderBy('next_run_at')
    .orderBy('id')
    .limit(1)
    .executeTakeFirst();
  return schedule
    ? {
        ...empty(a.LEG_VISIBILITY_RUN),
        state: a.LEG_STATE_WAITING,
        due_at: schedule.next_run_at,
        source_id: schedule.id,
      }
    : empty(a.LEG_VISIBILITY_RUN);
}

/**
 * A synced window that starts after the declaration day is what a traffic
 * check reads. Search Console finalizes a day after a short lag, so
 * the first such window is due then; past it, a sync is what is missing.
 */
export function searchConsoleState(
  declaredAt: Date,
  window: { start: string; end: string } | null,
  now: Date,
) {
  const day = declaredAt.toISOString().slice(0, 10);
  const ready = new Date(`${day}T00:00:00Z`);
  ready.setUTCDate(ready.getUTCDate() + 1 + a.SEARCH_CONSOLE_FINALIZATION_LAG_DAYS);
  const observed = window !== null && window.start > day;
  let state = a.LEG_STATE_WAITING;
  if (observed) state = a.LEG_STATE_OBSERVED;
  else if (now >= ready) state = a.LEG_STATE_SYNC_NEEDED;
  return { state, due_at: ready };
}

async function searchLeg(db: Database, row: Declaration, now: Date): Promise<Leg> {
  const base = db
    .selectFrom('traffic_snapshots')
    .select(['id', 'created_at'])
    .select([
      isoDateText(sql.ref('window_start')).as('start'),
      isoDateText(sql.ref('window_end')).as('end'),
    ])
    .where('workspace_id', '=', row.workspace_id)
    .where('project_id', '=', row.project_id);
  const window =
    (await base
      .where(
        'window_start',
        '>',
        sql<Date>`${row.declared_implemented_at.toISOString().slice(0, 10)}::date`,
      )
      .orderBy('window_end', 'desc')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst()) ??
    (await base.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(1).executeTakeFirst());
  return {
    ...empty(a.LEG_SEARCH_CONSOLE_WINDOW),
    ...searchConsoleState(row.declared_implemented_at, window ?? null, now),
    last_evidence_at: window?.created_at ?? null,
    source_id: window?.id ?? null,
  };
}

export async function measurementLegs(
  db: Database,
  row: Declaration,
  observations: Observation[],
  now = new Date(),
) {
  const checks = Array.isArray(row.expected_checks) ? row.expected_checks : [];
  const mapping: Record<string, string> = a.CHECK_KIND_MEASUREMENT_LEG;
  const legs = [
    ...new Set(checks.map((check) => mapping[String(record(check).kind)]).filter(Boolean)),
  ];
  const result: Leg[] = [];
  for (const leg of legs) {
    if (leg === a.LEG_CRAWL) result.push(await crawlLeg(db, row, observations));
    else if (leg === a.LEG_VISIBILITY_RUN) result.push(await visibilityLeg(db, row, observations));
    else if (leg === a.LEG_SEARCH_CONSOLE_WINDOW) result.push(await searchLeg(db, row, now));
  }
  return result;
}
