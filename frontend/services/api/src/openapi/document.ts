/**
 * The TypeScript service's OpenAPI document, generated from its route
 * contracts with zod's JSON Schema output. Request schemas use zod's input
 * view and responses its output view.
 */
import { z } from 'zod';

import type { RouteContract } from './routes.ts';

export type JsonSchema = { [key: string]: unknown };

/** Emits a request (`input`) or response (`output`) schema for the document. */
export type SchemaEmitter = (schema: z.ZodType, io: 'input' | 'output') => JsonSchema;

type OpenApiParameter = {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  schema: JsonSchema;
};

type OpenApiContent = Record<string, { schema: JsonSchema }>;

type OpenApiOperation = {
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: { required?: boolean; content: OpenApiContent };
  responses: Record<string, { description?: string; content?: OpenApiContent }>;
};

export type OpenApiDocument = {
  openapi: string;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    schemas?: Record<string, JsonSchema>;
    parameters?: Record<string, OpenApiParameter>;
  };
};

const OPENAPI_VERSION = '3.1.0';
const JSON_MEDIA_TYPE = 'application/json';

function jsonSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  const generated: JsonSchema = z.toJSONSchema(schema, { io });
  delete generated.$schema;
  return generated;
}

function parameters(location: OpenApiParameter['in'], object?: z.ZodObject): OpenApiParameter[] {
  if (!object) return [];
  const generated = jsonSchema(object, 'input');
  const properties = (generated.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((generated.required ?? []) as string[]);
  return Object.entries(properties).map(([name, schema]) => ({
    name,
    in: location,
    // OpenAPI requires every path parameter.
    required: location === 'path' || required.has(name),
    schema,
  }));
}

function operation(route: RouteContract<string>, emit: SchemaEmitter): OpenApiOperation {
  const result: OpenApiOperation = { tags: [route.family], responses: {} };
  const declared = [
    ...parameters('path', route.pathParams),
    ...parameters('query', route.query),
    ...parameters('header', route.headers),
    ...parameters('cookie', route.cookies),
  ];
  if (declared.length > 0) result.parameters = declared;
  if (route.body) {
    result.requestBody = {
      required: !route.body.safeParse(undefined).success,
      content: { [JSON_MEDIA_TYPE]: { schema: emit(route.body, 'input') } },
    };
  }
  for (const [status, schema] of Object.entries(route.responses)) {
    result.responses[status] =
      schema === null
        ? { description: 'Successful Response' }
        : {
            description: 'Successful Response',
            content: { [JSON_MEDIA_TYPE]: { schema: emit(schema, 'output') } },
          };
  }
  return result;
}

/** Bodies and responses are inlined unless `emit` references shared components. */
export function openApiDocument(
  routes: readonly RouteContract<string>[],
  emit: SchemaEmitter = jsonSchema,
): OpenApiDocument {
  const paths: OpenApiDocument['paths'] = {};
  for (const route of routes) {
    const item = (paths[route.path] ??= {});
    if (item[route.method]) {
      throw new Error(`Duplicate route contract: ${route.method.toUpperCase()} ${route.path}`);
    }
    item[route.method] = operation(route, emit);
  }
  return { openapi: OPENAPI_VERSION, paths };
}
