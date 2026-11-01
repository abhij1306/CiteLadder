/** The Prompt Builder's topic endpoints: a write-free preview and the confirmed plan. */
import { randomUUID } from 'node:crypto';

import type { topicPreviewResponseSchema, topicSchema } from '@citeladder/contracts/project';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { agentCallLimit, enforceWorkspaceRequest } from '../src/abuse/usage.ts';
import { createApp } from '../src/app.ts';
import { previewTopics } from '../src/prompts/topic-preview.ts';
import { recordingMeter } from './meter-fixtures.ts';
import { echoDependencies, prompt, promptSet, topic } from './prompt-fixtures.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

type Topic = z.infer<typeof topicSchema>;
type Preview = z.infer<typeof topicPreviewResponseSchema>;

const db = testDatabase();
const fixtures = new VisibilityFixtures(db);
const config = testConfig();
const app = createApp(config, db);
const offerings = ['Pro Series trail running shoe', 'Waterproof hiking boot', 'Kids school shoe'];
let t: Tenant;

beforeEach(async () => {
  t = await fixtures.tenant();
  await fixtures.brand(t.projectId, 'Acme');
  const brand = await db
    .selectFrom('brands')
    .select('id')
    .where('project_id', '=', t.projectId)
    .executeTakeFirstOrThrow();
  await db
    .insertInto('brand_profiles')
    .values({
      id: randomUUID(),
      workspace_id: t.workspaceId,
      project_id: t.projectId,
      brand_id: brand.id,
      description: '',
      positioning: '',
      products_services: JSON.stringify(offerings),
      target_audience: '',
      business_context: JSON.stringify({ category_terms: ['running shoes'] }),
      sources: '{}',
      source_artifact_ids: '{}',
      created_at: new Date(),
      updated_at: new Date(),
    })
    .execute();
});
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

async function call<T>(path: string, options: { method?: string; body?: unknown } = {}) {
  const token = await sessionToken({ sub: t.userId, ver: 0 });
  const response = await app.request(`/api/v1${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'x-workspace-id': t.workspaceId,
      cookie: `${TEST_SESSION_COOKIE}=${token}`,
      'content-type': 'application/json',
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}

const topicRows = () =>
  db
    .selectFrom('topics')
    .select(['name', 'origin'])
    .where('project_id', '=', t.projectId)
    .orderBy('name')
    .execute();
const topicLinks = async () =>
  (
    await db
      .selectFrom('brand_profiles')
      .select('business_context')
      .where('project_id', '=', t.projectId)
      .executeTakeFirstOrThrow()
  ).business_context as { topic_offerings?: Record<string, string[]> };

describe('topic preview', () => {
  it('proposes buyer-facing topics beside the existing ones and writes nothing', async () => {
    await topic(db, t.projectId, 'Trail running shoes');
    const { meter, features } = recordingMeter(t.workspaceId);
    const deps = echoDependencies({
      topics: [
        { name: 'Pro Series trail running shoes', offerings: [offerings[0]!] },
        { name: 'Hiking boots', offerings: [offerings[1]!] },
        { name: 'School shoes', offerings: [offerings[2]!] },
      ],
    });
    const preview = await previewTopics(db, t.workspaceId, t.projectId, {
      ...deps,
      meter: () => meter,
    });
    // The existing topic is never proposed again, and the product-line name is stripped.
    expect(preview).toEqual({
      source: 'model',
      topics: [
        { name: 'Hiking boots', offerings: [offerings[1]] },
        { name: 'School shoes', offerings: [offerings[2]] },
      ],
      overflow: [],
    });
    expect(features).toEqual(['prompt_generation']);
    expect(await topicRows()).toEqual([{ name: 'Trail running shoes', origin: 'manual' }]);
  });

  it('spends the provider-call window recovery uses before any model call', async () => {
    const limit = agentCallLimit(1);
    await enforceWorkspaceRequest(db, t.workspaceId, { ...limit, amount: limit.limit });
    const deps = echoDependencies();
    await expect(previewTopics(db, t.workspaceId, t.projectId, deps)).rejects.toMatchObject({
      status: 429,
    });
    expect(deps.io.fetch).not.toHaveBeenCalled();
  });

  it('needs saved offerings and the project in the active workspace', async () => {
    await db
      .updateTable('brand_profiles')
      .set({ products_services: '[]' })
      .where('project_id', '=', t.projectId)
      .execute();
    const deps = echoDependencies();
    await expect(previewTopics(db, t.workspaceId, t.projectId, deps)).rejects.toMatchObject({
      status: 422,
    });
    expect(deps.io.fetch).not.toHaveBeenCalled();
    const other = await fixtures.tenant();
    const crossed = await call<Preview>(`/projects/${other.projectId}/topics/preview`, {
      method: 'POST',
    });
    expect(crossed.status).toBe(404);
  });
});

describe('topic confirm', () => {
  it('deletes, renames and creates at once, linking proposals to their offerings', async () => {
    const setId = await promptSet(db, t.projectId);
    const stale = await topic(db, t.projectId, 'Shoes');
    const kept = await topic(db, t.projectId, 'Boots');
    const promptId = await prompt(db, setId, 'Which shoes suit flat feet?', { topicId: stale });
    const result = await call<Topic[]>(`/projects/${t.projectId}/topics/confirm`, {
      method: 'POST',
      body: {
        delete: [stale],
        rename: [{ id: kept, name: 'Hiking boots' }],
        create: [
          // A freed name is reusable in the same plan.
          { name: 'Shoes', offerings: [] },
          { name: 'Trail running shoes', offerings: [offerings[0], 'Not an offering'] },
        ],
      },
    });
    expect(result.status).toBe(200);
    expect(result.body.map((row) => [row.name, row.origin])).toEqual([
      ['Hiking boots', 'manual'],
      ['Shoes', 'manual'],
      ['Trail running shoes', 'generated'],
    ]);
    const created = result.body.find((row) => row.name === 'Trail running shoes')!;
    expect((await topicLinks()).topic_offerings).toEqual({ [created.id]: [offerings[0]] });
    // Deleting a topic keeps its prompts, detached.
    const detached = await db
      .selectFrom('prompts')
      .select('topic_id')
      .where('id', '=', promptId)
      .executeTakeFirstOrThrow();
    expect(detached.topic_id).toBeNull();
  });

  it('swaps two topic names in one plan', async () => {
    const boots = await topic(db, t.projectId, 'Boots');
    const shoes = await topic(db, t.projectId, 'Shoes');
    const result = await call<Topic[]>(`/projects/${t.projectId}/topics/confirm`, {
      method: 'POST',
      body: {
        rename: [
          { id: boots, name: 'Shoes' },
          { id: shoes, name: 'Boots' },
        ],
      },
    });
    expect(result.status).toBe(200);
    expect(result.body.map((row) => [row.id, row.name])).toEqual([
      [shoes, 'Boots'],
      [boots, 'Shoes'],
    ]);
  });

  it('applies nothing when a name collides or a topic belongs elsewhere', async () => {
    await topic(db, t.projectId, 'Boots');
    const duplicate = await call(`/projects/${t.projectId}/topics/confirm`, {
      method: 'POST',
      body: { create: [{ name: 'Sandals' }, { name: 'boots' }] },
    });
    expect(duplicate.status).toBe(409);
    const other = await fixtures.tenant();
    const foreign = await topic(db, other.projectId, 'Foreign');
    const crossed = await call(`/projects/${t.projectId}/topics/confirm`, {
      method: 'POST',
      body: { delete: [foreign], create: [{ name: 'Sandals' }] },
    });
    expect(crossed.status).toBe(404);
    expect(await topicRows()).toEqual([{ name: 'Boots', origin: 'manual' }]);
    expect(
      (
        await call(`/projects/${other.projectId}/topics/confirm`, {
          method: 'POST',
          body: { create: [{ name: 'Sandals' }] },
        })
      ).status,
    ).toBe(404);
  });
});
