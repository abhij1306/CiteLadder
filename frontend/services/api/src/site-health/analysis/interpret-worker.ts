import { parentPort } from 'node:worker_threads';
import { analyzePage } from './analyze-page.ts';
import { document } from '../../web-evidence/html.ts';
import { discoveryLinks } from '../discovery-links.ts';
import { extractPageFacts } from './facts.ts';
import type { Interpretation } from './off-thread.ts';

function interpret(input: Interpretation) {
  if (input.kind === 'analyze') return analyzePage(input.facts, input.context);
  const body = Buffer.from(input.body);
  if (input.kind === 'extract') return extractPageFacts(body, input.delivery, input.settings);
  const root = document(body, input.delivery.charset);
  const { finalUrl } = input.delivery;
  return {
    discovery: discoveryLinks(root, finalUrl, input.scope, input.settings.maxLinks),
    facts: extractPageFacts(body, input.delivery, input.settings, root),
  };
}

/** A persistent interpreter: one reply per id-tagged request, for the life of the pool. */
parentPort!.on('message', ({ id, input }: { id: number; input: Interpretation }) => {
  try {
    const result = interpret(input);
    parentPort!.postMessage({ id, result });
  } catch (error) {
    parentPort!.postMessage({
      id,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
});
