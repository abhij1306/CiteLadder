/**
 * The public API's OpenAPI document, generated from the `public` route
 * contracts. `GET /v1/openapi.json` serves it.
 *
 * Each shared contract schema is emitted once, under `components.schemas`,
 * with its contract export as its public name: `promptSetSchema` is `PromptSet`.
 */
import * as contracts from '@citeladder/contracts';
import { z } from 'zod';

import { policy } from '../config.ts';
import { componentSchemas } from '../openapi/components.ts';
import { openApiDocument, type OpenApiDocument } from '../openapi/document.ts';
import type { RouteContract } from '../openapi/routes.ts';

const P = policy.public_api;
const PROJECT_PREFIX = `${policy.api.machine_prefix}/projects/{project_id}/`;

/** The docs group of a public path: the resource below the project, else `projects`. */
function groupOf(path: string): string {
  if (!path.startsWith(PROJECT_PREFIX)) return 'projects';
  return path.slice(PROJECT_PREFIX.length).split('/')[0] ?? 'projects';
}

/** Contract schemas by public name; an alias keeps the first export's name. */
const CONTRACT_NAMES = new Map<z.ZodType, string>();
for (const [name, value] of Object.entries(contracts).sort(([a], [b]) => a.localeCompare(b)))
  if (name.endsWith('Schema') && value instanceof z.ZodType && !CONTRACT_NAMES.has(value))
    CONTRACT_NAMES.set(value, `${name[0]?.toUpperCase()}${name.slice(1, -'Schema'.length)}`);

export function publicApiDocument(routes: readonly RouteContract[]) {
  const published = routes.filter((contract) => contract.exposure === 'public');
  const { emit, components } = componentSchemas(
    published.flatMap((contract) => [
      ...(contract.body ? [{ schema: contract.body, io: 'input' as const }] : []),
      ...Object.values(contract.responses).flatMap((schema) =>
        schema === null ? [] : [{ schema, io: 'output' as const }],
      ),
    ]),
    CONTRACT_NAMES,
  );
  const document: OpenApiDocument = openApiDocument(published, emit);
  const paths = Object.fromEntries(
    Object.entries(document.paths).map(([path, item]) => [
      path,
      Object.fromEntries(
        Object.entries(item).map(([method, operation]) => {
          const scope = published.find(
            (contract) => contract.path === path && contract.method === method,
          )?.scope;
          // `x-citeladder-scope`: the API key scope the operation needs.
          return [
            method,
            {
              ...operation,
              tags: [groupOf(path)],
              ...(scope ? { 'x-citeladder-scope': scope } : {}),
            },
          ];
        }),
      ),
    ]),
  );
  return {
    openapi: document.openapi,
    info: { title: P.document.title, version: P.document.version },
    servers: [{ url: P.document.server_url }],
    security: [{ apiKey: [] }],
    components: {
      schemas: components,
      securitySchemes: {
        apiKey: { type: 'http', scheme: 'bearer', description: P.document.auth_description },
      },
    },
    paths,
  };
}
