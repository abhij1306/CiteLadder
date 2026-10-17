import { expect, it } from 'vite-plus/test';

import { runStepLabel, toolCallLabel } from './vocabulary';

it('keeps processing, failed, unknown and planned progress distinct', () => {
  const labels = ['processing', 'failed', 'new_status', 'reasoned'].map((status) =>
    runStepLabel({ status, tool: null }),
  );
  expect(new Set(labels).size).toBe(labels.length);
  // An unknown read outcome never reads as a completed one.
  expect(runStepLabel({ status: 'new_status', tool: 'read_site_health' })).not.toBe(
    runStepLabel({ status: 'completed', tool: 'read_site_health' }),
  );
});

it('names a running read and the agent’s own tools in the reader’s terms', () => {
  expect(
    [
      { tool: 'read_site_health', status: 'started' },
      { tool: 'read_site_health', status: 'unavailable' },
      { tool: 'load_skill', status: 'started' },
      { tool: 'save_document', status: 'completed' },
      { tool: 'save_document', status: 'refused' },
    ].map(toolCallLabel),
  ).toEqual([
    'Reading site health…',
    'Read site health · no data yet',
    'Loading the method…',
    'Saved the document',
    'Document not saved',
  ]);
});
