import { recordScreen, type RecordKindName } from '@citeladder/contracts/record-kinds';

export function appLink(
  origin: string,
  path: string,
  projectId: string,
  params: Record<string, string> = {},
): string {
  const url = new URL(path, 'https://app.invalid');
  for (const [key, value] of Object.entries({ ...params, project: projectId }))
    url.searchParams.set(key, value);
  const relative = `${url.pathname}${url.search}`;
  return origin ? new URL(relative, origin).href : relative;
}

export function recordPath(kind: RecordKindName, record: Record<string, unknown>): string {
  return recordScreen(kind, (key) => (typeof record[key] === 'string' ? record[key] : ''));
}
