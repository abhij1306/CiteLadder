import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { assertResponseContract } from '../src/routes/response-contract.ts';

const schema = z.object({
  id: z.string(),
  at: z.iso.datetime(),
  items: z.array(z.object({ name: z.string() })),
  extra: z.record(z.string(), z.unknown()),
});

describe('response contract under test', () => {
  it('passes a declared body, including free-form records and serialized dates', () => {
    expect(() =>
      assertResponseContract(
        schema,
        {
          id: 'a',
          at: new Date('2026-11-13T00:00:00.000Z'),
          items: [{ name: 'x' }],
          extra: { anything: 1 },
          omitted: undefined,
        },
        'GET /x',
      ),
    ).not.toThrow();
  });
  it('names each undeclared field a spread row would leak', () => {
    expect(() =>
      assertResponseContract(
        schema,
        {
          id: 'a',
          at: '2026-11-13T00:00:00.000Z',
          workspace_id: 'w',
          items: [{ name: 'x', secret: 's' }],
          extra: {},
        },
        'GET /x',
      ),
    ).toThrow(
      'The response of GET /x carries undeclared fields: $.workspace_id, $.items[0].secret',
    );
  });
  it('refuses a body breaking a declared field', () => {
    expect(() =>
      assertResponseContract(schema, { id: 1, at: 'no', items: [], extra: {} }, 'GET /x'),
    ).toThrow(/^The response of GET \/x breaks its contract/);
  });
});
