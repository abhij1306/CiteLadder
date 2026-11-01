import { describe, expect, it, vi } from 'vitest';

import { createModelGateway, gatewaySettings } from '../src/models/gateway.ts';
import { productLineTerms, proposeTopics } from '../src/prompts/topic-proposals.ts';
import { recordingMeter } from './meter-fixtures.ts';

const offerings = [
  'Pro Series golf practice net',
  'Home Series golf practice net',
  'Mini golf practice net (5x6 ft)',
  'Goal Post football sideline kicking net',
  'Swing Haven launch monitor bundle',
];
const input = {
  offerings,
  existing: [],
  brandNames: ['The Swing Haven', 'Swing Haven'],
  categoryTerms: ['golf net', 'practice net', 'football kicking net'],
  limit: 10,
};
const signal = () => new AbortController().signal;

/** A metered model gateway whose one answer is `topics`, or a provider failure. */
function gateway(topics: { name: string; offerings: string[] }[] | 'fail') {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    topics === 'fail'
      ? new Response('bad request', { status: 400 })
      : Response.json({ choices: [{ message: { content: JSON.stringify({ topics }) } }] }),
  );
  const raw = createModelGateway(
    {
      ...gatewaySettings({}),
      apiKey: 'test-only',
      model: 'test-model',
      baseUrl: 'https://model.test',
    },
    { fetch, sleep: async () => {} },
  );
  return recordingMeter().meter.gateway(raw, 'prompt_generation');
}

describe('topic proposals', () => {
  it('finds product-line names, not sentence-case words or category vocabulary', () => {
    expect(
      productLineTerms(
        [
          ...offerings,
          'Accessories: hitting mats, Clear Air Zone side barriers',
          'Bundles (Pro, Home, Clear Air Zone)',
        ],
        input.categoryTerms,
      ),
    ).toEqual(['Pro Series', 'Home Series', 'Goal Post', 'Swing Haven', 'Clear Air Zone']);
  });

  it("keeps the model's buyer categories grounded in confirmed offerings, merged and capped", async () => {
    const result = await proposeTopics(
      { ...input, limit: 2 },
      gateway([
        { name: 'Golf practice nets', offerings: [offerings[0]!, offerings[1]!] },
        { name: 'Pro Series nets', offerings: [offerings[0]!] },
        { name: 'Kicking nets', offerings: [offerings[3]!] },
        { name: 'Launch monitor bundles', offerings: [offerings[4]!] },
        { name: 'Tennis rackets', offerings: ['Tennis rackets'] },
        { name: 'Golf practice net', offerings: [offerings[2]!] },
      ]),
      signal(),
    );
    expect(result).toMatchObject({
      source: 'model',
      topics: [
        { name: 'Golf practice nets', offerings: [offerings[0], offerings[1], offerings[2]] },
        { name: 'Kicking nets', offerings: [offerings[3]] },
      ],
      overflow: [{ name: 'Launch monitor bundles', offerings: [offerings[4]] }],
      dropped: [
        { name: 'Pro Series nets', reason: 'empty' },
        { name: 'Tennis rackets', reason: 'unsupported' },
        { name: 'Golf practice net', reason: 'merged' },
      ],
    });
  });

  it('falls back to the offerings, cleaned of brand, product lines and specifications', async () => {
    const result = await proposeTopics(
      { ...input, existing: ['Kicking nets'] },
      gateway('fail'),
      signal(),
    );
    expect(result).toEqual({
      source: 'offerings',
      model: null,
      topics: [
        { name: 'Golf practice net', offerings: [offerings[0], offerings[1]] },
        { name: 'Mini golf practice net', offerings: [offerings[2]] },
        { name: 'Football sideline kicking net', offerings: [offerings[3]] },
        { name: 'Launch monitor bundle', offerings: [offerings[4]] },
      ],
      overflow: [],
      dropped: [{ name: 'Golf practice net', reason: 'merged' }],
    });
  });

  it('drops a proposal repeating an existing topic and never names the brand', async () => {
    const result = await proposeTopics(
      { ...input, existing: ['Golf practice nets'] },
      gateway([
        { name: 'Golf practice nets', offerings: [offerings[0]!] },
        { name: 'The Swing Haven football kicking nets', offerings: [offerings[3]!] },
      ]),
      signal(),
    );
    // The model's repeat, then the two offerings it left uncovered, cleaned to the same topic.
    expect(result.dropped).toEqual([
      { name: 'Golf practice nets', reason: 'existing' },
      { name: 'Golf practice net', reason: 'existing' },
      { name: 'Golf practice net', reason: 'existing' },
    ]);
    expect(result.topics.map((topic) => topic.name)).toEqual([
      'Football kicking nets',
      'Mini golf practice net',
      'Launch monitor bundle',
    ]);
  });
});
