import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { componentSchemas } from '../src/openapi/components.ts';
import { openApiDocument } from '../src/openapi/document.ts';
import type { RouteContract } from '../src/openapi/routes.ts';

const tag = z.object({ label: z.string() });
const item = z.object({ id: z.string(), tags: z.array(tag) });
const names = new Map<z.ZodType, string>([
  [tag, 'Tag'],
  [item, 'Item'],
]);

function documentFor(routes: RouteContract<string>[]) {
  const { emit, components } = componentSchemas(
    routes.flatMap((route) => [
      ...(route.body ? [{ schema: route.body, io: 'input' as const }] : []),
      ...Object.values(route.responses).flatMap((schema) =>
        schema ? [{ schema, io: 'output' as const }] : [],
      ),
    ]),
    names,
  );
  return { ...openApiDocument(routes, emit), components };
}

describe('shared OpenAPI components', () => {
  it('emits a named schema once and references it from every operation', () => {
    const document = documentFor([
      { family: 'items', method: 'get', path: '/v1/items/{id}', responses: { 200: item } },
      {
        family: 'items',
        method: 'get',
        path: '/v1/items',
        responses: { 200: z.object({ items: z.array(item) }) },
      },
    ]);
    expect(document.components).toEqual({
      Item: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          tags: { type: 'array', items: { $ref: '#/components/schemas/Tag' } },
        },
        required: ['id', 'tags'],
        additionalProperties: false,
      },
      Tag: {
        type: 'object',
        properties: { label: { type: 'string' } },
        required: ['label'],
        additionalProperties: false,
      },
    });
    expect(document.paths['/v1/items/{id}']?.get?.responses[200]?.content).toEqual({
      'application/json': { schema: { $ref: '#/components/schemas/Item' } },
    });
    expect(document.paths['/v1/items']?.get?.responses[200]?.content).toEqual({
      'application/json': {
        schema: {
          type: 'object',
          properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Item' } } },
          required: ['items'],
          additionalProperties: false,
        },
      },
    });
  });

  it('names the request view separately when it differs from the response view', () => {
    const page = z.object({ size: z.number().default(10) });
    const body = z.object({ page });
    const { emit, components } = componentSchemas(
      [
        { schema: body, io: 'input' },
        { schema: page, io: 'output' },
      ],
      new Map([[page, 'Page']]),
    );
    expect(emit(body, 'input')).toMatchObject({
      properties: { page: { $ref: '#/components/schemas/PageInput' } },
    });
    expect(emit(page, 'output')).toEqual({ $ref: '#/components/schemas/Page' });
    expect(components).toEqual({
      Page: {
        type: 'object',
        properties: { size: { type: 'number', default: 10 } },
        required: ['size'],
        additionalProperties: false,
      },
      PageInput: {
        type: 'object',
        properties: { size: { type: 'number', default: 10 } },
      },
    });
  });
});
