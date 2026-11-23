export function localDay(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export function declarationDays(declarableSince: string, now: Date) {
  const since = new Date(declarableSince);
  const first = new Date(since.getFullYear(), since.getMonth(), since.getDate(), 12);
  if (first < since) first.setDate(first.getDate() + 1);
  return { min: localDay(first), max: localDay(now) };
}

function dayParts(day: string): [number, number, number] {
  const [year = Number.NaN, month = Number.NaN, date = Number.NaN] = day.split('-').map(Number);
  return [year, month, date];
}

export function isDeclarableDay(day: string, range: { min: string; max: string }): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [year, month, date] = dayParts(day);
  const parsed = new Date(year, month - 1, date);
  if (parsed.getMonth() !== month - 1 || parsed.getDate() !== date) return false;
  return day >= range.min && day <= range.max;
}

export function declaredInstant(day: string, openedAt: Date): string {
  if (day === localDay(openedAt)) return openedAt.toISOString();
  const [year, month, date] = dayParts(day);
  return new Date(year, month - 1, date, 12).toISOString();
}
