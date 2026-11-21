import { sql, type RawBuilder } from 'kysely';
import { policy } from '../config.ts';

export type TaskOutcome = 'excluded' | 'not_page' | 'blocked' | 'gone' | 'error';

type CodedOutcome = Exclude<TaskOutcome, 'gone' | 'error'>;

const rules = policy.site_health.reads.task_outcomes;
const CODED: Record<CodedOutcome, readonly string[]> = {
  excluded: rules.excluded_error_codes,
  not_page: rules.not_page_error_codes,
  blocked: rules.blocked_error_codes,
};
const CODED_ORDER: readonly CodedOutcome[] = ['excluded', 'not_page', 'blocked'];
const CODED_ERRORS = CODED_ORDER.flatMap((outcome) => CODED[outcome]);
const GONE_STATUSES = rules.gone_status_codes;

export function taskOutcome(failure: {
  errorCode: string;
  statusCode?: number | null;
}): TaskOutcome {
  const coded = CODED_ORDER.find((outcome) => CODED[outcome].includes(failure.errorCode));
  if (coded) return coded;
  return GONE_STATUSES.includes(failure.statusCode ?? 0) ? 'gone' : 'error';
}

type TaskAlias = 'site_crawl_tasks' | 't';

export function failedAs(
  task: TaskAlias,
  outcomes: readonly [Exclude<TaskOutcome, 'error'>, ...Exclude<TaskOutcome, 'error'>[]],
): RawBuilder<boolean> {
  const code = sql.ref(`${task}.error_code`);
  const id = sql.ref(`${task}.id`);
  const workspace = sql.ref(`${task}.workspace_id`);
  const crawl = sql.ref(`${task}.crawl_id`);
  const terms = outcomes.map((outcome) =>
    outcome === 'gone'
      ? sql`(${code} <> all(${CODED_ERRORS}::text[]) and exists (select 1 from site_fetch_attempts a
          where a.task_id = ${id} and a.workspace_id = ${workspace} and a.crawl_id = ${crawl}
            and a.status_code = any(${GONE_STATUSES}::int[])))`
      : sql`${code} = any(${CODED[outcome]}::text[])`,
  );
  const or = sql` or `;
  return sql<boolean>`(${sql.join(terms, or)})`;
}
