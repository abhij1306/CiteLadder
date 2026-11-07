/**
 * What a failed Site Health crawl task's failure means, decided once. Every
 * consumer reads the category and keeps its own decision about it (counts it,
 * releases the URL, hides it from errors); none restates the code lists.
 *
 * - `excluded`: the site's robots.txt or the crawl's admission policy declined the URL.
 * - `not_page`: the URL answered with something that is not an HTML page.
 * - `blocked`: access controls, bot protection, an unreadable robots.txt or the
 *   safety policy stopped the fetch.
 * - `gone`: a fetch answered 404/410.
 * - `error`: anything else.
 *
 * The code categories are disjoint and decided by the task's `error_code`;
 * `gone` is decided by a fetch's status and only for a code in none of them.
 */
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

/** One failure's category; `statusCode` is the failing fetch's HTTP status, when it answered. */
export function taskOutcome(failure: {
  errorCode: string;
  statusCode?: number | null;
}): TaskOutcome {
  const coded = CODED_ORDER.find((outcome) => CODED[outcome].includes(failure.errorCode));
  if (coded) return coded;
  return GONE_STATUSES.includes(failure.statusCode ?? 0) ? 'gone' : 'error';
}

/** The `site_crawl_tasks` alias a SQL predicate reads. */
type TaskAlias = 'site_crawl_tasks' | 't';

/**
 * A SQL predicate true when the aliased task's failure falls in one of
 * `outcomes`, by the same rules as `taskOutcome`. It reads only the failure;
 * the caller still filters `status = 'failed'`. `gone` reads the task's fetch
 * attempts: any of them answering 404/410.
 */
export function failedAs(
  task: TaskAlias,
  outcomes: readonly [Exclude<TaskOutcome, 'error'>, ...Exclude<TaskOutcome, 'error'>[]],
): RawBuilder<boolean> {
  const code = sql.ref(`${task}.error_code`);
  const id = sql.ref(`${task}.id`);
  const workspace = sql.ref(`${task}.workspace_id`);
  const terms = outcomes.map((outcome) =>
    outcome === 'gone'
      ? sql`(${code} <> all(${CODED_ERRORS}::text[]) and exists (select 1 from site_fetch_attempts a
          where a.task_id = ${id} and a.workspace_id = ${workspace}
            and a.status_code = any(${GONE_STATUSES}::int[])))`
      : sql`${code} = any(${CODED[outcome]}::text[])`,
  );
  const or = sql` or `;
  return sql<boolean>`(${sql.join(terms, or)})`;
}
