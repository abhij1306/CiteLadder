import { appLink } from './links.ts';
import type { Evidence, ProjectRead } from './types.ts';

type Read = Pick<ProjectRead, 'origin' | 'scope'>;

export const projectExport = ({ origin, scope }: Read, path: string, params = {}) =>
  appLink(origin, `/api/v1/projects/${scope.projectId}${path}`, scope.projectId, params);

export function withCsvExport(
  read: Read,
  evidence: Evidence,
  file: { path: string; args: object; params: readonly (readonly [string, string])[] },
): Evidence {
  if (evidence.state !== 'available') return evidence;
  const args = new Map(Object.entries(file.args));
  const params = Object.fromEntries(
    file.params.flatMap(([name, from]) => {
      const value = args.get(from);
      return typeof value === 'string' || typeof value === 'number' ? [[name, String(value)]] : [];
    }),
  );
  return { ...evidence, export_csv: projectExport(read, file.path, params) };
}

export const sameNames = (...names: string[]) => names.map((name) => [name, name] as const);
