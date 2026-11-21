type JobState<Badge extends string> = Readonly<{
  label: string;
  badge: Badge;
  active: boolean;
}>;

export type JobStates<Status extends string, Badge extends string> = Readonly<
  Record<Status, JobState<Badge>>
>;

export function pollWhileActive<Status extends string>(
  states: Readonly<Record<Status, { active: boolean }>>,
  intervalMs: number,
  statuses: Status | readonly Status[] | null | undefined,
): number | false {
  if (statuses === null || statuses === undefined) return false;
  const list: readonly Status[] = typeof statuses === 'string' ? [statuses] : statuses;
  return list.some((status) => states[status].active) ? intervalMs : false;
}
