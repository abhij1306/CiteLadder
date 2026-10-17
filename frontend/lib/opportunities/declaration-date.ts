/**
 * The "went live on" date of an implementation declaration.
 *
 * The user picks a calendar day in their own time zone; the server stores an
 * instant and refuses one in the future or before `declarable_since`. Today
 * becomes the moment the dialog opened, so a same-day declaration never lands
 * after the reading it should precede. An earlier day becomes its local noon,
 * which stays on that calendar day in every time zone the user could be in.
 */

/** A local calendar day as `YYYY-MM-DD`. */
export function localDay(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * The days a declaration may name: from the first day whose declared instant
 * the server's window still accepts, through today.
 */
export function declarationDays(declarableSince: string, now: Date) {
  const since = new Date(declarableSince);
  const first = new Date(since.getFullYear(), since.getMonth(), since.getDate(), 12);
  if (first < since) first.setDate(first.getDate() + 1);
  return { min: localDay(first), max: localDay(now) };
}

/** Whether `day` is a real `YYYY-MM-DD` date inside `[min, max]`. */
export function isDeclarableDay(day: string, range: { min: string; max: string }): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const parsed = new Date(year, month - 1, date);
  if (parsed.getMonth() !== month - 1 || parsed.getDate() !== date) return false;
  return day >= range.min && day <= range.max;
}

/** The instant a chosen day declares; today is the moment the dialog opened. */
export function declaredInstant(day: string, openedAt: Date): string {
  if (day === localDay(openedAt)) return openedAt.toISOString();
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, date, 12).toISOString();
}
