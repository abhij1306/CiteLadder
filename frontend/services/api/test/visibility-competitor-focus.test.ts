import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { policy } from '../src/config.ts';
import { record } from '../src/db/json.ts';
import { promptSet, prompt as trackedPrompt } from './prompt-fixtures.ts';
import type { Tenant } from './visibility-fixtures.ts';
import { frozen, route, visibilityReads } from './visibility-read-support.ts';

const { db, fixtures, get } = visibilityReads();

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

describe('GET /visibility/competitors/{name}', () => {
  let tenant: Tenant;
  let auditId: string;
  let tracked: string;

  beforeAll(async () => {
    tenant = await fixtures.tenant();
    await fixtures.competitor(tenant.projectId, { name: 'Globex' });
    await fixtures.competitor(tenant.projectId, { name: 'Initech' });
    tracked = await trackedPrompt(db, await promptSet(db, tenant.projectId), 'best crm');
    auditId = await fixtures.audit(tenant, { configuration: frozen() });
    const answer = (input: {
      prompt: number;
      engine: string;
      you: boolean;
      named: string[];
      cited: string[];
    }) =>
      fixtures.execution(tenant, {
        auditId,
        promptIndex: input.prompt,
        promptId: input.prompt === 0 ? tracked : undefined,
        promptText: ['best crm', 'cheap crm', 'crm for teams'][input.prompt],
        theme: input.prompt === 1 ? 'Pricing' : '',
        engine: input.engine,
        analysis: {
          brandMentioned: input.you,
          brandMentions: input.you ? ['Acme Corp'] : [],
          competitorMentions: input.named,
          citations: input.cited.map((domain) => ({ url: `https://${domain}/page` })),
        },
      });
    await answer({
      prompt: 0,
      engine: 'chatgpt',
      you: false,
      named: ['Globex'],
      cited: ['g2.example', 'review.example'],
    });
    await answer({
      prompt: 0,
      engine: 'gemini',
      you: true,
      named: ['Globex'],
      cited: ['g2.example'],
    });
    await answer({ prompt: 1, engine: 'chatgpt', you: false, named: ['Globex'], cited: [] });
    await answer({
      prompt: 1,
      engine: 'perplexity',
      you: true,
      named: [],
      cited: ['review.example'],
    });
    await answer({
      prompt: 2,
      engine: 'chatgpt',
      you: false,
      named: ['Initech'],
      cited: ['other.example'],
    });
  });

  it('serves the sources cited when it is named and the prompts naming it instead of you', async () => {
    const { status, body } = await get(tenant, route(tenant, '/competitors/Globex'), {
      audit_id: auditId,
    });
    expect(status).toBe(200);
    expect(body).toEqual({
      competitor: { id: expect.any(String), name: 'Globex' },
      answers: 3,
      sources: [
        { domain: 'g2.example', answers: 2, answers_naming_you: 1 },
        { domain: 'review.example', answers: 1, answers_naming_you: 1 },
      ],
      sources_total: 2,
      named_instead: [
        {
          prompt_id: tracked,
          prompt: 'best crm',
          topic: 'Untagged',
          engines: 1,
          engines_answered: 2,
        },
        {
          prompt_id: null,
          prompt: 'cheap crm',
          topic: 'Pricing',
          engines: 1,
          engines_answered: 2,
        },
      ],
      named_instead_total: 2,
    });
  });

  it('caps each list and counts every row the cap hides', async () => {
    const limits = policy.visibility;
    const { competitor_sources_limit: sources, competitor_named_instead_limit: prompts } = limits;
    limits.competitor_sources_limit = 1;
    limits.competitor_named_instead_limit = 1;
    try {
      const { body } = await get(tenant, route(tenant, '/competitors/Globex'), {
        audit_id: auditId,
      });
      expect([
        body.sources,
        body.sources_total,
        body.named_instead,
        body.named_instead_total,
      ]).toEqual([
        [expect.objectContaining({ domain: 'g2.example' })],
        2,
        [expect.objectContaining({ prompt: 'best crm' })],
        2,
      ]);
    } finally {
      limits.competitor_sources_limit = sources;
      limits.competitor_named_instead_limit = prompts;
    }
  });

  it('reads only the answers in the selected frozen topic', async () => {
    const topic = randomUUID();
    await db
      .updateTable('audit_prompt_snapshots')
      .set({ topic_id: topic, topic_name: 'Pricing' })
      .where('audit_id', '=', auditId)
      .where('text', '=', 'cheap crm')
      .execute();
    const { body } = await get(tenant, route(tenant, '/competitors/Globex'), {
      audit_id: auditId,
      topic,
    });
    expect([body.answers, body.sources, body.named_instead]).toEqual([
      1,
      [],
      [{ prompt_id: null, prompt: 'cheap crm', topic: 'Pricing', engines: 1, engines_answered: 2 }],
    ]);
  });

  it('flags a source that never appears beside you', async () => {
    const { body } = await get(tenant, route(tenant, '/competitors/Initech'), {
      audit_id: auditId,
    });
    expect([body.answers, body.sources, body.named_instead]).toEqual([
      1,
      [{ domain: 'other.example', answers: 1, answers_naming_you: 0 }],
      [
        {
          prompt_id: null,
          prompt: 'crm for teams',
          topic: 'Untagged',
          engines: 1,
          engines_answered: 1,
        },
      ],
    ]);
  });

  it('is not found for a name off the roster, or from another workspace', async () => {
    const outsider = await fixtures.tenant();
    await fixtures.competitor(outsider.projectId, { name: 'Globex' });
    const [unknown, foreign, listed] = await Promise.all([
      get(tenant, route(tenant, '/competitors/Hooli'), { audit_id: auditId }),
      get(outsider, route(tenant, '/competitors/Globex'), { audit_id: auditId }),
      get(tenant, route(tenant, '/competitors/Globex'), { audit_id: auditId }),
    ]);
    expect([
      unknown.status,
      record(unknown.body.error).code,
      foreign.status,
      record(foreign.body.error).message,
      listed.status,
    ]).toEqual([404, 'competitor_not_found', 404, 'Project not found', 200]);
    const crossed = await get(outsider, route(outsider, '/competitors/Globex'), {
      audit_id: auditId,
    });
    expect([crossed.status, record(crossed.body.error).code]).toEqual([404, 'not_found']);
  });
});
