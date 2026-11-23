import { expect, it } from 'vite-plus/test';

import type { AgentStep } from '@citeladder/contracts/agent';
import { activityLabel, activityRows, activitySummary, callStep, modelStepLabel } from './activity';

const read = (tool: string, status = 'completed', target: string | null = null): AgentStep => ({
  kind: 'tool',
  ordinal: 1,
  tool,
  status,
  call_id: `call_${tool}_${status}`,
  target,
});

const lines = (steps: AgentStep[]) =>
  activityRows(steps).map((row) => [activityLabel(row), row.detail, row.state]);

it('keeps processing, failed, unknown and planned model steps distinct', () => {
  const labels = ['processing', 'failed', 'new_status', 'reasoned'].map(modelStepLabel);
  expect(new Set(labels).size).toBe(labels.length);
});

it('names each kind of step as a verb and the reader’s noun, never a tool name or a model call', () => {
  expect(
    lines([
      { kind: 'model', ordinal: 1 },
      { kind: 'skill', skill_id: 'plan' },
      read('read_actions'),
      read('read_visibility_overview'),
      read('search', 'completed', 'school uniform'),
      read('read_page_text', 'completed', 'https://acme.example/returns'),
      { kind: 'search', ordinal: 1, status: 'completed', call_id: 's1', query: 'uniform prices' },
      read('read_performance', 'unavailable'),
      read('read_brand_new_thing'),
      { kind: 'document', action: 'created', number: 1, title: 'Returns page plan' },
      { kind: 'document', action: 'edited', number: 1, title: 'Returns page plan' },
      { kind: 'document', action: 'replaced', number: 2, title: 'Brief' },
      { kind: 'suggestion' },
      { kind: 'proposal', label: 'https://acme.example/returns' },
      { kind: 'change', label: 'Add 2 prompts to “Main”' },
      { kind: 'model', ordinal: 2 },
    ]),
  ).toEqual([
    ['Loaded the method', null, 'done'],
    ['Read Actions', null, 'done'],
    ['Read AI visibility', null, 'done'],
    ['Searched CiteLadder', 'school uniform', 'done'],
    ['Read page', 'https://acme.example/returns', 'done'],
    ['Searched the web', 'uniform prices', 'done'],
    ['Read search performance', 'no data yet', 'unavailable'],
    ['Read CiteLadder data', null, 'done'],
    ['Saved Document 1', 'Returns page plan', 'done'],
    ['Edited Document 1', 'Returns page plan', 'done'],
    ['Replaced Document 2', 'Brief', 'done'],
    ['Suggested changes', null, 'done'],
    ['Suggested marking an Action implemented', 'https://acme.example/returns', 'done'],
    ['Suggested a change', 'Add 2 prompts to “Main”', 'done'],
  ]);
});

it('hides refused calls, says what failed and keeps an unknown outcome apart from a completed one', () => {
  expect(
    lines([
      read('fetch', 'refused'),
      read('read_source_url', 'failed', 'https://other.example/a'),
      { kind: 'search', ordinal: 1, status: 'failed', call_id: 's1', query: 'uniform' },
      read('read_site_health', 'new_status'),
      read('save_document', 'refused'),
    ]),
  ).toEqual([
    ['Couldn’t read a cited page', 'https://other.example/a', 'failed'],
    ['Couldn’t search the web', 'uniform', 'failed'],
    ['Read Website', 'outcome unknown', 'unknown'],
  ]);
  expect(activityRows([{ kind: 'model', ordinal: 1 }, read('fetch', 'refused')])).toEqual([]);
});

it('shows a running call, built-ins included, in the present tense', () => {
  expect(
    lines(
      [
        { ordinal: 2, tool: null, status: 'working', call_id: null, target: null },
        { ordinal: 2, tool: 'read_actions', status: 'started', call_id: 'a', target: null },
        { ordinal: 2, tool: 'web_search', status: 'started', call_id: 'b', target: null },
        { ordinal: 2, tool: 'save_document', status: 'started', call_id: 'c', target: null },
      ].map(callStep),
    ),
  ).toEqual([
    ['Reading Actions', null, 'running'],
    ['Searching the web', null, 'running'],
    ['Saving a document', null, 'running'],
  ]);
});

it('summarises rows by verb in first-seen order, folding repeats and long lists', () => {
  const rows = activityRows([
    read('read_actions'),
    read('read_visibility_overview'),
    read('search', 'completed', 'uniform'),
    read('read_actions'),
    { kind: 'document', action: 'created', number: 1, title: 'Plan' },
  ]);
  expect(activitySummary(rows)).toBe(
    'Read Actions and AI visibility · searched CiteLadder · saved Document 1',
  );
  const many = activityRows(
    ['read_actions', 'read_demand', 'read_site_health', 'read_ai_shelf', 'read_performance'].map(
      (tool) => read(tool),
    ),
  );
  expect(activitySummary(many)).toBe('Read Actions, search demand and 3 more');
});
