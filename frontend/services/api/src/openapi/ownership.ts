/**
 * Every API operation carries one declared route family, every family is
 * served, and one route module serves each family.
 */
import type { OpenApiDocument } from './document.ts';
import { onlyOf } from '../lists.ts';

export type OwnershipInputs = {
  /** The browser API and API-host machine prefixes. */
  prefixes: readonly string[];
  families: readonly string[];
  document: OpenApiDocument;
  /**
   * The families each route module's own routes declare, keyed by module.
   * A route's `/v1` mirror is not listed: it is the owning module's route
   * published on the public API, not a second writer of `public-api`.
   */
  modules: Readonly<Record<string, readonly string[]>>;
};

function declaredFamilies(families: readonly string[], failures: string[]) {
  const declared = new Set<string>();
  for (const family of families) {
    if (declared.has(family)) failures.push(`'${family}' is listed more than once`);
    declared.add(family);
  }
  return declared;
}
function servedFamilies(inputs: OwnershipInputs, declared: Set<string>, failures: string[]) {
  const served = new Set<string>();
  for (const [path, item] of Object.entries(inputs.document.paths)) {
    if (!inputs.prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)))
      continue;
    for (const [method, operation] of Object.entries(item)) {
      const family = onlyOf(new Set(operation.tags ?? []));
      if (family === undefined) {
        failures.push(`${method.toUpperCase()} ${path} must carry exactly one family tag`);
        continue;
      }
      served.add(family);
      if (!declared.has(family))
        failures.push(`${method.toUpperCase()} ${path} serves '${family}', which is not a family`);
    }
  }
  return served;
}

function familyModuleFailures(modules: OwnershipInputs['modules'], failures: string[]) {
  const servers = new Map<string, Set<string>>();
  for (const [module, families] of Object.entries(modules))
    for (const family of families)
      servers.set(family, (servers.get(family) ?? new Set()).add(module));
  for (const [family, owners] of servers)
    if (owners.size > 1)
      failures.push(`'${family}' is served by more than one module: ${[...owners].join(', ')}`);
}

export function routeOwnershipFailures(inputs: OwnershipInputs): string[] {
  const failures: string[] = [];
  const declared = declaredFamilies(inputs.families, failures);
  const served = servedFamilies(inputs, declared, failures);
  for (const family of declared)
    if (!served.has(family)) failures.push(`'${family}' has no declared route`);
  familyModuleFailures(inputs.modules, failures);
  return failures;
}
