import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { stepTarget } from '../src/agent/sources.ts';
import { agentPolicy } from '../src/agent/contracts.ts';

it('names what a read looked at from its first free-text argument, never an id, enum or budget', () => {
  const id = randomUUID();
  expect(
    [
      { query: `school\n uniform citeladder://action/${id} ${randomUUID()}`, limit: 5 },
      { project_id: id, status: 'open', domain: ' acme.example ' },
      { project_id: id, url: '', entity: 'Acme' },
      { audit_id: id, limit: 20, view: 'quotes' },
      { query: 'x'.repeat(agentPolicy.step_detail_max_chars + 50) },
      'not an object',
    ].map(stepTarget),
  ).toEqual([
    'school uniform',
    'acme.example',
    'Acme',
    null,
    'x'.repeat(agentPolicy.step_detail_max_chars),
    null,
  ]);
});
