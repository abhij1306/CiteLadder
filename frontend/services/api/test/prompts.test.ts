import { randomUUID } from 'node:crypto';

import type {
  promptCandidateReviewResponseSchema,
  promptCandidateSchema,
  promptSchema,
  promptSetSchema,
  topicSchema,
} from '@citeladder/contracts/project';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { enforceWorkspaceRequest } from '../src/abuse/usage.ts';
import { createApp } from '../src/app.ts';
import { ApiError } from '../src/errors.ts';
import { candidate, generationRun, prompt, promptSet, topic } from './prompt-fixtures.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

type Prompt = z.infer<typeof promptSchema>;
type PromptSet = z.infer<typeof promptSetSchema>;
type Topic = z.infer<typeof topicSchema>;
type Candidate = z.infer<typeof promptCandidateSchema>;
type Review = z.infer<typeof promptCandidateReviewResponseSchema>;
type ErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };

const db = testDatabase();
const fixtures = new VisibilityFixtures(db);
const config = testConfig();
const app = createApp(config, db);
let t: Tenant & { setId: string };

beforeEach(async () => {
  const tenant = await fixtures.tenant();
  await fixtures.brand(tenant.projectId, 'Acme Running');
  t = {
    ...tenant,
    setId: await promptSet(db, tenant.projectId),
  };
});
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

async function call<T>(
  path: string,
  options: { method?: string; body?: unknown; workspace?: string } = {},
): Promise<{ status: number; body: T }> {
  const token = await sessionToken({ sub: t.userId, ver: 0 });
  const response = await app.request(`/api/v1${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'x-workspace-id': options.workspace ?? t.workspaceId,
      cookie: `${TEST_SESSION_COOKIE}=${token}`,
      'content-type': 'application/json',
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}

const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body });
const patch = <T>(path: string, body: unknown) => call<T>(path, { method: 'PATCH', body });
const promptTexts = async () =>
  (await db.selectFrom('prompts').select('text').where('prompt_set_id', '=', t.setId).execute())
    .map((row) => row.text)
    .sort();

describe('prompt sets', () => {
  it('lists, creates, edits and deletes sets inside the workspace only', async () => {
    const created = await post<PromptSet>('/prompt-sets', { project_id: t.projectId, name: 'B' });
    expect(created.status).toBe(201);
    await prompt(db, created.body.id, 'acme running shoes');
    const edited = await patch<PromptSet>(`/prompt-sets/${created.body.id}`, { description: 'd' });
    expect(edited.body).toMatchObject({ name: 'B', description: 'd', prompt_count: 1 });
    const listed = await call<PromptSet[]>(`/prompt-sets?project_id=${t.projectId}`);
    expect(listed.body.map((set) => set.id).sort()).toEqual([t.setId, created.body.id].sort());

    const other = await fixtures.tenant();
    const foreign = await promptSet(db, other.projectId);
    expect((await call(`/prompt-sets/${foreign}`)).status).toBe(404);
    expect((await post('/prompt-sets', { project_id: other.projectId })).status).toBe(404);

    expect((await call(`/prompt-sets/${created.body.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await call(`/prompt-sets/${created.body.id}`)).status).toBe(404);
  });
});

describe('manual prompts', () => {
  it('admits bound text, rejects off-topic text and duplicates', async () => {
    const created = await post<Prompt>(`/prompt-sets/${t.setId}/prompts`, {
      text: '  Best running shoes for flat feet? ',
      intent: 'Discovery',
      cohort: 'brand_diagnostic',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      text: 'Best running shoes for flat feet?',
      intent: 'discovery',
      branded: true,
      origin: 'manual',
      status: 'active',
    });
    const duplicate = await post<ErrorBody>(`/prompt-sets/${t.setId}/prompts`, {
      text: 'best running shoes for flat feet',
    });
    expect(duplicate.status).toBe(409);
    const offTopic = await post<ErrorBody>(`/prompt-sets/${t.setId}/prompts`, {
      text: 'cheapest flights to lisbon',
    });
    expect([offTopic.status, offTopic.body.error.code]).toEqual([422, 'prompt_off_topic']);
    const longest = `acme ${'x'.repeat(295)}`;
    expect((await post(`/prompt-sets/${t.setId}/prompts`, { text: longest })).status).toBe(201);
    expect((await post(`/prompt-sets/${t.setId}/prompts`, { text: `${longest}y` })).status).toBe(
      422,
    );
    expect((await post(`/prompt-sets/${t.setId}/prompts`, { text: '   ' })).status).toBe(422);
  });

  it('files a prompt naming the brand as branded unless a cohort is chosen', async () => {
    await fixtures.competitor(t.projectId, { name: 'Globex' });
    const create = async (body: Record<string, unknown>) =>
      (await post<Prompt>(`/prompt-sets/${t.setId}/prompts`, body)).body;
    const filed = await Promise.all([
      create({ text: 'Is Acme Running good for trail shoes?', persona: ' Trail runners ' }),
      create({ text: 'Acme Running or Globex for running shoes?' }),
      create({ text: 'Which running shoes last longest?' }),
      create({ text: 'Acme Running shoes for flat feet?', cohort: 'core' }),
    ]);
    expect(filed.map((row) => [row.cohort, row.branded, row.persona])).toEqual([
      ['brand_diagnostic', true, 'Trail runners'],
      ['comparison', true, ''],
      ['core', false, ''],
      ['core', false, ''],
    ]);
    const imported = await post<PromptSet>(`/prompt-sets/${t.setId}/import`, {
      prompts: [{ text: 'Is Acme Running sold online?', topic: '', persona: 'Shoppers' }],
    });
    expect(
      imported.body.prompts
        .filter((row) => row.text === 'Is Acme Running sold online?')
        .map((row) => [row.cohort, row.persona, row.origin]),
    ).toEqual([['brand_diagnostic', 'Shoppers', 'imported']]);
  });

  it('binds against the prompt topic and refuses a topic from another project', async () => {
    const topicId = await topic(db, t.projectId, 'Trail gear', 'hydration packs');
    const filed = await post<Prompt>(`/prompt-sets/${t.setId}/prompts`, {
      text: 'lightest hydration packs',
      topic_id: topicId,
    });
    expect([filed.status, filed.body.topic_id]).toEqual([201, topicId]);
    const other = await fixtures.tenant();
    const foreignTopic = await topic(db, other.projectId, 'Acme');
    const refused = await post(`/prompt-sets/${t.setId}/prompts`, {
      text: 'acme running socks',
      topic_id: foreignTopic,
    });
    expect(refused.status).toBe(404);
  });

  it('fails closed on an empty vocabulary', async () => {
    const bareProject = await fixtures.project(t.workspaceId, 'https://bare.example');
    const bareSet = await promptSet(db, bareProject);
    const empty = await post<ErrorBody>(`/prompt-sets/${bareSet}/prompts`, { text: 'anything' });
    expect([empty.status, empty.body.error.code]).toEqual([422, 'binding_vocabulary_empty']);
  });
});

describe('prompt edits', () => {
  it('rehashes edited text, keeps the set unique and detaches on explicit null', async () => {
    const topicId = await topic(db, t.projectId, 'Trail gear', 'hydration packs');
    const first = await prompt(db, t.setId, 'acme trail shoes', { topicId });
    await prompt(db, t.setId, 'acme road shoes');
    const clash = await patch(`/prompts/${first}`, { text: 'Acme road shoes!' });
    expect(clash.status).toBe(409);
    const kept = await patch<Prompt>(`/prompts/${first}`, { theme: ' trail ' });
    expect([kept.body.theme, kept.body.topic_id]).toEqual(['trail', topicId]);
    const detached = await patch<Prompt>(`/prompts/${first}`, { topic_id: null });
    expect(detached.body.topic_id).toBeNull();
  });

  it('corrects intent and buyer stage tags and refuses an unknown stage', async () => {
    const id = await prompt(db, t.setId, 'acme trail shoes');
    const tagged = await patch<Prompt>(`/prompts/${id}`, {
      intent: 'comparison',
      buyer_stage: 'decision',
    });
    expect([tagged.body.intent, tagged.body.buyer_stage]).toEqual(['comparison', 'decision']);
    const kept = await patch<Prompt>(`/prompts/${id}`, { theme: 'trail' });
    expect(kept.body.buyer_stage).toBe('decision');
    expect((await patch(`/prompts/${id}`, { buyer_stage: 'someday' })).status).toBe(422);
    const persona = await patch<Prompt>(`/prompts/${id}`, { persona: ' Trail runners ' });
    expect([persona.body.persona, persona.body.buyer_stage]).toEqual(['Trail runners', 'decision']);
    expect((await patch(`/prompts/${id}`, { persona: 'x'.repeat(121) })).status).toBe(422);
  });

  it('re-binds on activation against the prompt topic', async () => {
    const topicId = await topic(db, t.projectId, 'Trail gear', 'hydration packs');
    const archived = await prompt(db, t.setId, 'lightest hydration packs', {
      status: 'archived',
      topicId,
    });
    const activated = await patch<Prompt>(`/prompts/${archived}`, { status: 'active' });
    expect(activated.body.status).toBe('active');
    const stray = await prompt(db, t.setId, 'cheapest flights to lisbon', { status: 'archived' });
    expect((await patch(`/prompts/${stray}`, { status: 'active' })).status).toBe(422);
  });

  it('requires topical binding when an active prompt is moved to another topic', async () => {
    const topicId = await topic(db, t.projectId, 'Trail gear', 'hydration packs');
    const fits = await prompt(db, t.setId, 'lightest hydration packs');
    const stray = await prompt(db, t.setId, 'cheapest flights to lisbon');
    expect((await patch(`/prompts/${stray}`, { topic_id: topicId })).status).toBe(422);
    const moved = await patch<Prompt>(`/prompts/${fits}`, { topic_id: topicId });
    expect([moved.status, moved.body.topic_id]).toEqual([200, topicId]);
    const unchanged = await db
      .selectFrom('prompts')
      .select('topic_id')
      .where('id', '=', stray)
      .executeTakeFirstOrThrow();
    expect(unchanged.topic_id).toBeNull();
  });

  it('transitions a whole selection or none of it', async () => {
    const one = await prompt(db, t.setId, 'acme trail shoes', { status: 'archived' });
    const stray = await prompt(db, t.setId, 'cheapest flights to lisbon', { status: 'archived' });
    const rejected = await post<ErrorBody>(`/prompt-sets/${t.setId}/prompts/bulk-status`, {
      prompt_ids: [one, stray],
      status: 'active',
    });
    expect(rejected.status).toBe(422);
    expect(rejected.body.error.details).toMatchObject({ prompts: [{ prompt_id: stray }] });
    const missing = await post(`/prompt-sets/${t.setId}/prompts/bulk-status`, {
      prompt_ids: [one, randomUUID()],
      status: 'active',
    });
    expect(missing.status).toBe(404);
    const statuses = await db
      .selectFrom('prompts')
      .select('status')
      .where('id', '=', one)
      .execute();
    expect(statuses).toEqual([{ status: 'archived' }]);
    const done = await post<PromptSet>(`/prompt-sets/${t.setId}/prompts/bulk-status`, {
      prompt_ids: [one],
      status: 'active',
    });
    expect(done.body.prompts.find((row) => row.id === one)?.status).toBe('active');
  });
});

describe('import', () => {
  it('inserts bound rows once, reuses and creates topics, and counts only inserts', async () => {
    const existingTopic = await topic(db, t.projectId, 'Trail Gear');
    await prompt(db, t.setId, 'acme trail shoes');
    const imported = await post<PromptSet>(`/prompt-sets/${t.setId}/import`, {
      prompts: [
        { text: 'Acme trail shoes?', topic: 'trail gear' },
        {
          text: 'acme road shoes',
          topic: 'trail gear',
          cohort: 'comparison',
          buyer_stage: 'consideration',
        },
        { text: 'acme road shoes.', topic: 'Road' },
        { text: '   ', topic: 'Blank' },
        { text: 'acme racing flats', topic: 'Road' },
      ],
    });
    expect(imported.status).toBe(201);
    const byText = new Map(imported.body.prompts.map((row) => [row.text, row]));
    expect(byText.get('acme road shoes')).toMatchObject({
      topic_id: existingTopic,
      cohort: 'comparison',
      buyer_stage: 'consideration',
      branded: true,
      origin: 'imported',
    });
    const topics = await db
      .selectFrom('topics')
      .select('name')
      .where('project_id', '=', t.projectId)
      .execute();
    expect(topics.map((row) => row.name).sort()).toEqual(['Road', 'Trail Gear']);
    expect(await promptTexts()).toEqual([
      'acme racing flats',
      'acme road shoes',
      'acme trail shoes',
    ]);
  });

  it('rejects the whole upload when a row is off-topic', async () => {
    const offTopic = await post<ErrorBody>(`/prompt-sets/${t.setId}/import`, {
      prompts: [{ text: 'acme trail shoes' }, { text: 'cheapest flights to lisbon' }],
    });
    expect(offTopic.status).toBe(422);
    expect(offTopic.body.error.details).toMatchObject({
      rows: [{ row: 1, code: 'prompt_off_topic' }],
    });
    expect(await promptTexts()).toEqual([]);
    expect(
      await db.selectFrom('topics').select('id').where('project_id', '=', t.projectId).execute(),
    ).toEqual([]);
  });

  it('spends the workspace import budget before reading the upload', async () => {
    const limit = { operation: `bulk_import_test_${randomUUID()}`, limit: 1, windowSeconds: 3600 };
    await enforceWorkspaceRequest(db, t.workspaceId, limit);
    const refused = await enforceWorkspaceRequest(db, t.workspaceId, limit).catch(
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(ApiError);
    expect((refused as ApiError).status).toBe(429);
    expect(Number((refused as ApiError).headers?.['retry-after'])).toBeGreaterThan(0);
  });
});

describe('candidate review', () => {
  async function run(provenance: Record<string, unknown> = { quality_gate: 'shadow', model: 'm' }) {
    return generationRun(
      db,
      { workspaceId: t.workspaceId, projectId: t.projectId, setId: t.setId },
      provenance,
    );
  }

  it('lists pending candidates newest first, flagged last, with their quality status', async () => {
    const older = await run({ quality_gate: 'off' });
    const newer = await run();
    const scope = { workspaceId: t.workspaceId, setId: t.setId };
    const earlier = new Date(Date.now() - 60_000);
    await candidate(db, { ...scope, runId: older }, 'acme old one', { createdAt: earlier });
    await candidate(db, { ...scope, runId: newer }, 'acme flagged', {
      decision: { flags: ['vague'], rank_score: 9 },
    });
    const now = (
      await db
        .selectFrom('prompt_candidates')
        .select('created_at')
        .where('text', '=', 'acme flagged')
        .executeTakeFirstOrThrow()
    ).created_at;
    await candidate(db, { ...scope, runId: newer }, 'acme strong', {
      decision: { rank_score: 5 },
      createdAt: now,
    });
    await candidate(db, { ...scope, runId: newer }, 'acme expired', {
      expiresAt: new Date(Date.now() - 1),
    });
    const listed = await call<Candidate[]>(`/prompt-sets/${t.setId}/candidates`);
    expect(listed.body.map((row) => [row.text, row.quality_status, row.quality_flags])).toEqual([
      ['acme strong', 'judged', []],
      ['acme flagged', 'judged', ['vague']],
      ['acme old one', 'off', []],
    ]);
  });

  it('accepts into prompts with provenance and keeps judged rejections text-free', async () => {
    const runId = await run();
    const scope = { workspaceId: t.workspaceId, setId: t.setId, runId };
    const topicId = await topic(db, t.projectId, 'Road');
    const accept = await candidate(db, scope, 'acme road shoes', {
      topicId,
      cohort: 'comparison',
      evidenceRefs: [{ kind: 'business_map_cell', audience: 'Road runners' }, { kind: 'page' }],
    });
    const already = await candidate(db, scope, 'acme trail shoes');
    await prompt(db, t.setId, 'Acme trail shoes?');
    const judged = await candidate(db, scope, 'acme flats', {
      decision: { flags: [], duplicate_of: { id: 'x', text: 'secret' } },
    });
    const unjudged = await candidate(db, scope, 'acme socks');
    const review = await post<Review>(`/prompt-sets/${t.setId}/candidates/review`, {
      accept_ids: [accept, already],
      reject_ids: [judged, unjudged, randomUUID()],
    });
    expect(review.status).toBe(200);
    expect(review.body).toMatchObject({
      rejected_count: 2,
      dropped_duplicates: 1,
      unavailable_count: 1,
    });
    expect(review.body.accepted).toHaveLength(1);
    expect(review.body.accepted[0]).toMatchObject({
      text: 'acme road shoes',
      theme: 'Road',
      origin: 'generated',
      branded: true,
      persona: 'Road runners',
    });
    // Views omit the evidence; the provenance stays on the stored prompt.
    expect(review.body.accepted[0]).not.toHaveProperty('generation_evidence');
    const stored = await db
      .selectFrom('prompts')
      .select('generation_evidence')
      .where('id', '=', review.body.accepted[0]!.id)
      .executeTakeFirstOrThrow();
    expect(stored.generation_evidence).toMatchObject({
      model: 'm',
      candidate_id: accept,
      generation_run_id: runId,
    });
    const rows = await db
      .selectFrom('prompt_candidates')
      .select(['id', 'disposition', 'text', 'jev_decision', 'prompt_id'])
      .where('prompt_set_id', '=', t.setId)
      .execute();
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(accept)).toMatchObject({
      disposition: 'accepted',
      prompt_id: review.body.accepted[0]!.id,
    });
    expect(byId.get(judged)).toMatchObject({
      disposition: 'rejected',
      text: '',
      jev_decision: { flags: [], duplicate_of: { id: 'x', text: null } },
    });
    expect(byId.has(already) || byId.has(unjudged)).toBe(false);
  });

  it('purges expired candidates and outcome records before reviewing', async () => {
    const runId = await run();
    const scope = { workspaceId: t.workspaceId, setId: t.setId, runId };
    const stale = await candidate(db, scope, 'acme stale', { expiresAt: new Date(Date.now() - 1) });
    const outcome = await candidate(db, scope, 'acme judged', { decision: { flags: [] } });
    await db
      .updateTable('prompt_candidates')
      .set({ disposition: 'gate_rejected', text: '', expires_at: new Date(Date.now() - 1) })
      .where('id', '=', outcome)
      .execute();
    const review = await post<Review>(`/prompt-sets/${t.setId}/candidates/review`, {
      reject_ids: [stale],
    });
    expect(review.body.unavailable_count).toBe(1);
    const left = await db
      .selectFrom('prompt_candidates')
      .select('id')
      .where('id', 'in', [stale, outcome])
      .execute();
    expect(left).toEqual([]);
  });

  it('refuses an empty or contradictory review', async () => {
    const id = randomUUID();
    expect((await post(`/prompt-sets/${t.setId}/candidates/review`, {})).status).toBe(422);
    expect(
      (
        await post(`/prompt-sets/${t.setId}/candidates/review`, {
          accept_ids: [id],
          reject_ids: [id],
        })
      ).status,
    ).toBe(422);
  });
});

describe('topics', () => {
  it('creates one level of nesting, names case-insensitively and counts active prompts', async () => {
    const parent = await post<Topic>(`/projects/${t.projectId}/topics`, { name: ' Shoes ' });
    expect([parent.status, parent.body.name]).toEqual([201, 'Shoes']);
    expect((await post(`/projects/${t.projectId}/topics`, { name: 'shoes' })).status).toBe(409);
    const child = await post<Topic>(`/projects/${t.projectId}/topics`, {
      name: 'Trail',
      parent_id: parent.body.id,
    });
    expect(child.body.parent_id).toBe(parent.body.id);
    expect(
      (await post(`/projects/${t.projectId}/topics`, { name: 'Deep', parent_id: child.body.id }))
        .status,
    ).toBe(422);
    expect((await patch(`/topics/${parent.body.id}`, { parent_id: child.body.id })).status).toBe(
      422,
    );
    expect((await patch(`/topics/${parent.body.id}`, { parent_id: parent.body.id })).status).toBe(
      422,
    );

    await prompt(db, t.setId, 'acme trail shoes', { topicId: child.body.id });
    await prompt(db, t.setId, 'acme old shoes', { topicId: child.body.id, status: 'archived' });
    const listed = await call<Topic[]>(`/projects/${t.projectId}/topics`);
    expect(listed.body.map((row) => [row.name, row.active_count])).toEqual([
      ['Shoes', 0],
      ['Trail', 1],
    ]);
    const promoted = await patch<Topic>(`/topics/${child.body.id}`, { parent_id: null });
    expect([promoted.body.parent_id, promoted.body.active_count]).toEqual([null, 1]);
  });

  it('detaches prompts when a topic is deleted and hides other workspaces', async () => {
    const id = await topic(db, t.projectId, 'Shoes');
    const promptId = await prompt(db, t.setId, 'acme shoes', { topicId: id });
    expect((await call(`/topics/${id}`, { method: 'DELETE' })).status).toBe(204);
    const row = await db
      .selectFrom('prompts')
      .select('topic_id')
      .where('id', '=', promptId)
      .executeTakeFirstOrThrow();
    expect(row.topic_id).toBeNull();
    const other = await fixtures.tenant();
    expect((await call(`/projects/${other.projectId}/topics`)).status).toBe(404);
    expect(
      (await patch(`/topics/${await topic(db, other.projectId, 'X')}`, { name: 'Y' })).status,
    ).toBe(404);
  });
});
