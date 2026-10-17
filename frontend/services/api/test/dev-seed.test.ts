import { beforeAll, expect, it, vi } from 'vitest';
import { disposableDatabase } from './disposable-database.ts';
import { loadConfig } from '../src/config.ts';
import { seedStatic, type StaticSeed } from '../src/cli/seed-static.ts';
import {
  seedProjectAudit,
  seedSiteHealth,
  seedOpportunityRefresh,
  drainSeed,
} from '../src/cli/seed-runs.ts';
import { seedIntegrations } from '../src/cli/seed-integrations.ts';
import { seedIntegrationClient, seedAnswer } from '../src/cli/seed-transports.ts';
import { createSecretCipher } from '../src/integrations/fernet.ts';
import { promptTextHash } from '../src/prompts/normalization.ts';
const { db, env } = disposableDatabase();
let seed: StaticSeed;
beforeAll(async () => {
  seed = await seedStatic(db, loadConfig(env), env.ENCRYPTION_KEY);
}, 60000);
it('repeats static state without deleting/recreating identities, respects tenant ownership and hashes prompts', async () => {
  expect(await seedStatic(db, loadConfig(env), env.ENCRYPTION_KEY)).toEqual(seed);
  const main = await db
    .selectFrom('projects')
    .selectAll()
    .where('workspace_id', '=', seed.primary.workspaceId)
    .execute();
  expect(main.map((p) => p.id)).toEqual([seed.primary.projectId]);
  const prompts = await db
    .selectFrom('prompts')
    .selectAll()
    .where('prompt_set_id', '=', seed.primary.setId)
    .execute();
  expect(prompts).toHaveLength(11);
  for (const prompt of prompts)
    expect(prompt.normalized_text_hash).toBe(promptTextHash(prompt.text));
  const connections = await db
    .selectFrom('provider_connections')
    .selectAll()
    .where('workspace_id', '=', seed.primary.workspaceId)
    .execute();
  expect(connections).toHaveLength(3);
  for (const connection of connections)
    expect(createSecretCipher(env.ENCRYPTION_KEY).decrypt(connection.api_key_encrypted!)).toMatch(
      /^dev-fake-key/u,
    );
}, 60000);
it('runs recorded audits and preserves exact artifact/analysis provenance without calling a provider', async () => {
  const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('live transport forbidden');
  });
  try {
    const id = await seedProjectAudit(db, seed.primary, env.ENCRYPTION_KEY);
    const artifacts = await db
      .selectFrom('raw_response_artifacts')
      .select('id')
      .where('audit_id', '=', id)
      .execute();
    const analyses = await db
      .selectFrom('response_analyses')
      .select(['artifact_id'])
      .where('audit_id', '=', id)
      .execute();
    expect(artifacts.length).toBeGreaterThan(0);
    expect(new Set(analyses.map((a) => a.artifact_id))).toEqual(
      new Set(artifacts.map((a) => a.id)),
    );
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
}, 120000);
it('imports GSC/GA4 through recorded transports and records immutable source artifacts', async () => {
  const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('live transport forbidden');
  });
  try {
    const ids = await seedIntegrations(db, seed.primary, env.ENCRYPTION_KEY);
    const artifacts = await db
      .selectFrom('integration_import_artifacts')
      .selectAll()
      .where('workspace_id', '=', seed.primary.workspaceId)
      .where('sync_run_id', 'in', ids)
      .execute();
    expect(artifacts.length).toBeGreaterThan(0);
    expect(new Set(artifacts.map((a) => a.sync_run_id))).toEqual(new Set(ids));
    expect(network).not.toHaveBeenCalled();
    await expect(
      seedIntegrationClient('2026-09-01').io.fetch('https://unexpected.example/'),
    ).rejects.toThrow('unexpected_seed_integration_request');
  } finally {
    network.mockRestore();
  }
}, 60000);
it('runs recorded discovery/selection/analysis and refreshes the exact completed crawl', async () => {
  const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('live transport forbidden');
  });
  try {
    const crawlId = await seedSiteHealth(db, seed.primary);
    const taskId = await seedOpportunityRefresh(db, seed.primary, 'site_crawl', crawlId);
    expect(await seedOpportunityRefresh(db, seed.primary, 'site_crawl', crawlId)).toBe(taskId);
    const task = await db
      .selectFrom('analytics_tasks')
      .select(['payload', 'status'])
      .where('id', '=', taskId)
      .executeTakeFirstOrThrow();
    expect(task).toMatchObject({
      status: 'succeeded',
      payload: { trigger_kind: 'site_crawl', trigger_id: crawlId },
    });
    const analyses = await db
      .selectFrom('site_page_analyses')
      .select('source_artifact_ids')
      .where('crawl_id', '=', crawlId)
      .execute();
    expect(analyses.length).toBeGreaterThan(0);
    const artifacts = new Set(
      (
        await db
          .selectFrom('site_fetch_artifacts')
          .select('id')
          .where('crawl_id', '=', crawlId)
          .execute()
      ).map((a) => a.id),
    );
    for (const analysis of analyses)
      for (const id of analysis.source_artifact_ids as string[])
        expect(artifacts.has(id)).toBe(true);
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
}, 120000);
it('fails bounded drains on a terminal failure, timeout or executor error', async () => {
  await expect(drainSeed([], async () => 'failed', ['completed'])).rejects.toThrow(
    'seed_terminal_failure',
  );
  await expect(drainSeed([], async () => 'running', ['completed'], 0.01)).rejects.toThrow(
    'seed_drain_timeout',
  );
  await expect(
    drainSeed(
      [
        {
          name: 'fixture',
          run: async () => {
            throw new Error('fixture');
          },
        },
      ],
      async () => 'running',
      ['completed'],
    ),
  ).rejects.toThrow('Runner lanes failed');
  expect(seedAnswer('backpacks', 2).answer_text).toContain('Acme Outdoor Co.');
});
