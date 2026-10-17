import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openApiDocument } from '../src/openapi/document.ts';
import { routeOwnershipFailures, type OwnershipInputs } from '../src/openapi/ownership.ts';

function ownershipInputs(overrides: Partial<OwnershipInputs> = {}): OwnershipInputs {
  return {
    prefixes: ['/api/v1', '/v1'],
    families: ['executions'],
    document: openApiDocument([
      {
        family: 'executions',
        method: 'get',
        path: '/api/v1/executions/{item_id}',
        pathParams: z.object({ item_id: z.uuid() }),
        responses: { 200: z.object({ name: z.string() }) },
      },
    ]),
    ...overrides,
  };
}
describe('route-ownership gate', () => {
  it('accepts declared families', () => {
    expect(routeOwnershipFailures(ownershipInputs())).toEqual([]);
  });
  it('rejects a served family missing from the manifest', () => {
    expect(routeOwnershipFailures(ownershipInputs({ families: [] }))).toEqual([
      "GET /api/v1/executions/{item_id} serves 'executions', which is not a family",
    ]);
  });
  it('rejects a manifest family without a route', () => {
    expect(
      routeOwnershipFailures(ownershipInputs({ families: ['executions', 'billing'] })),
    ).toContainEqual(expect.stringContaining('has no declared route'));
  });
  it('refuses a family listed twice', () => {
    expect(
      routeOwnershipFailures(ownershipInputs({ families: ['executions', 'executions'] })),
    ).toEqual(["'executions' is listed more than once"]);
  });
  it('counts a machine route under /v1 as serving its family', () => {
    const machine = openApiDocument([
      {
        family: 'executions',
        method: 'post',
        path: '/v1/executions/{item_id}',
        pathParams: z.object({ item_id: z.uuid() }),
        responses: { 200: z.object({ name: z.string() }) },
      },
    ]);
    expect(routeOwnershipFailures(ownershipInputs({ document: machine }))).toEqual([]);
    expect(
      routeOwnershipFailures(ownershipInputs({ document: machine, prefixes: ['/api/v1'] })),
    ).toEqual(["'executions' has no declared route"]);
  });
  it('refuses ambiguous family tags', () => {
    const input = ownershipInputs();
    input.document.paths['/api/v1/executions/{item_id}']!.get!.tags = ['executions', 'billing'];
    expect(routeOwnershipFailures(input)).toContainEqual(
      expect.stringContaining('exactly one family tag'),
    );
  });
});
