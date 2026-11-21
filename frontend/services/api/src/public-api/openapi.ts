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
import { openApiDocument, type JsonSchema, type OpenApiDocument } from '../openapi/document.ts';
import type { RouteContract } from '../openapi/routes.ts';
import { exampleOf } from './example.ts';
import { docKey, OPERATION_DOCS } from './operation-docs.ts';

const P = policy.public_api;
const PROJECT_PREFIX = `${policy.api.machine_prefix}/projects/{project_id}/`;

function groupOf(path: string): string {
  if (!path.startsWith(PROJECT_PREFIX)) return 'projects';
  return path.slice(PROJECT_PREFIX.length).split('/')[0] ?? 'projects';
}

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
  const documented = new Set<string>();
  const json = (media: { schema: JsonSchema }, example: unknown) => ({
    'application/json': { ...media, example },
  });
  const paths = Object.fromEntries(
    Object.entries(document.paths).map(([path, item]) => [
      path,
      Object.fromEntries(
        Object.entries(item).map(([method, operation]) => {
          const scope = published.find(
            (contract) => contract.path === path && contract.method === method,
          )?.scope;
          const key = docKey(method, path);
          const doc = OPERATION_DOCS[key];
          if (!doc) throw new Error(`Public operation ${key} has no entry in operation-docs`);
          documented.add(key);
          const body = operation.requestBody?.content['application/json'];
          const responses = Object.fromEntries(
            Object.entries(operation.responses).map(([status, response]) => {
              const media = response.content?.['application/json'];
              const example = media && exampleOf(media.schema, { components, io: 'output' });
              return [status, media ? { ...response, content: json(media, example) } : response];
            }),
          );
          return [
            method,
            {
              ...operation,
              summary: doc.summary,
              description: doc.description,
              tags: [groupOf(path)],
              ...(operation.requestBody && body
                ? {
                    requestBody: {
                      ...operation.requestBody,
                      content: json(
                        body,
                        doc.request ?? exampleOf(body.schema, { components, io: 'input' }),
                      ),
                    },
                  }
                : {}),
              responses,
              ...(scope ? { 'x-citeladder-scope': scope } : {}),
            },
          ];
        }),
      ),
    ]),
  );
  const stale = Object.keys(OPERATION_DOCS).filter((key) => !documented.has(key));
  if (stale.length > 0) throw new Error(`operation-docs entries match no operation: ${stale}`);
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
