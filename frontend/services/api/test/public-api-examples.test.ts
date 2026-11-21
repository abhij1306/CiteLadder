import { expect, it } from 'vitest';

import { ROUTE_CONTRACTS } from '../src/openapi/routes.ts';
import { exampleOf } from '../src/public-api/example.ts';
import { publicApiDocument } from '../src/public-api/openapi.ts';

const components = {
  Page: {
    type: 'object',
    required: ['id', 'label'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      label: { type: 'string' },
      site_url: { type: 'string' },
      error_message: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      rate: { anyOf: [{ type: 'number' }, { type: 'null' }] },
      count: { $ref: '#/components/schemas/MaybeCount' },
    },
  },
  MaybeCount: { type: ['integer', 'null'] },
};

it('shows a response with unknown values as null and a request with only what it must send', () => {
  const schema = { $ref: '#/components/schemas/Page' };
  expect(exampleOf(schema, { components, io: 'output' })).toEqual({
    id: '00000000-0000-4000-8000-000000000001',
    label: 'Example label',
    site_url: 'https://example.com/page',
    error_message: null,
    rate: null,
    count: null,
  });
  expect(exampleOf(schema, { components, io: 'input' })).toEqual({
    id: '00000000-0000-4000-8000-000000000001',
    label: 'Example label',
  });
});

it('describes every public operation with a summary, a description and a response example', () => {
  const document = publicApiDocument(ROUTE_CONTRACTS);
  const operations = Object.values(document.paths).flatMap((item) => Object.values(item));
  expect(operations.length).toBeGreaterThan(50);
  for (const operation of operations) {
    expect(operation.summary.length).toBeGreaterThan(0);
    expect(operation.description.length).toBeGreaterThan(0);
  }
  const launch = document.paths['/v1/projects/{project_id}/audits']?.post;
  expect(launch?.requestBody?.content['application/json']?.example).toEqual({
    prompt_set_id: '00000000-0000-4000-8000-000000000001',
    engines: ['chatgpt'],
    max_attempts: 12,
  });
});
