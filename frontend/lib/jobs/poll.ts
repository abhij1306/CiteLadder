/**
 * Job states and the one poll-while-active rule (F7).
 *
 * Every job family (runs, executions, sync runs, Search Intelligence runs,
 * range tasks, crawls) exports one exhaustive `JobStates` record: the label a
 * reader sees, the badge value it renders with, and whether the job is still
 * moving on its own. A status the server adds fails the type check here
 * instead of rendering raw or polling forever.
 */

/** How one status reads and whether a job in it is still progressing. */
type JobState<Badge extends string> = Readonly<{
  label: string;
  badge: Badge;
  /** True while the job changes without the reader doing anything: poll it. */
  active: boolean;
}>;

export type JobStates<Status extends string, Badge extends string> = Readonly<
  Record<Status, JobState<Badge>>
>;

/**
 * The poll cadence while any of `statuses` is active, or `false` (React
 * Query's "stop") once none is. An absent read is not yet known to be active,
 * so it does not poll; the first read decides.
 */
export function pollWhileActive<Status extends string>(
  states: Readonly<Record<Status, { active: boolean }>>,
  intervalMs: number,
  statuses: Status | readonly Status[] | null | undefined,
): number | false {
  if (statuses === null || statuses === undefined) return false;
  const list: readonly Status[] = typeof statuses === 'string' ? [statuses] : statuses;
  return list.some((status) => states[status].active) ? intervalMs : false;
}
