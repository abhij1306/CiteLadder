/**
 * Workspace fairness, lane by lane, against real PostgreSQL: a quiet
 * workspace's only task is served before a busy workspace's second task even
 * though the busy backlog has higher priority and has waited longer.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { createAudits } from '../src/audits/creation.ts';
import { auditRuntime } from '../src/audits/config.ts';
import { auditInput } from '../src/audits/inputs.ts';
import { AgentQueue } from '../src/agent/queue.ts';
import { integrationSettings } from '../src/integrations/config.ts';
import { createDiscovery } from '../src/projects/discovery.ts';
import { discoveryCreate } from '../src/projects/discovery-inputs.ts';
import { AuditQueue, type AuditClaimScope } from '../src/queue/audit-queue.ts';
import { ANALYTICS_LANE, SITE_HEALTH_LANE, TaskQueue } from '../src/queue/task-queue.ts';
import { DiscoveryWorker } from '../src/workers/discovery-worker.ts';
import { IntegrationWorker } from '../src/workers/integration-worker.ts';
import { AgentFixtures } from './agent-support.ts';
import { auditTenant } from './audit-fixtures.ts';
import { prompt } from './prompt-fixtures.ts';
import { seedProject } from './referral-fixtures.ts';
import { SiteFixtures } from './site-health-fixtures.ts';
import { testDatabase } from './support.ts';

const db = testDatabase();
const fixtures = new SiteFixtures(db);
const agentFixtures = new AgentFixtures(db);
// Kinds no production worker drains, so unscoped claims see only this file's rows.
const ANALYTICS_PROBE = 'fairness_probe';
const SITE_PROBE = 'fairness_probe';

afterAll(async () => {
  await agentFixtures.cleanup();
  await fixtures.cleanup();
  await db.destroy();
});

type Backlog = { priority: number; count: number; availableAt: Date };
/** One queue lane as its worker uses it: seed a workspace's backlog, claim the next row. */
type Lane = {
  /** A fresh workspace holding `count` claimable rows; returns its ID. */
  seed: (backlog: Backlog) => Promise<string>;
  /** The workspace of the next claimed row, or null when nothing was claimed. */
  claimNext: () => Promise<string | null>;
};

async function analyticsTasks(workspaceId: string, backlog: Backlog) {
  for (let index = 0; index < backlog.count; index += 1) {
    const id = randomUUID();
    await db
      .insertInto('analytics_tasks')
      .values({
        id,
        workspace_id: workspaceId,
        task_kind: ANALYTICS_PROBE,
        payload: {},
        idempotency_key: `fairness-test:${id}`,
        status: 'queued',
        priority: backlog.priority,
        randomized_position: 0,
        available_at: backlog.availableAt,
        attempt_count: 0,
        max_attempts: 3,
        error_code: '',
        error_detail: '',
        created_at: backlog.availableAt,
        updated_at: backlog.availableAt,
      })
      .execute();
  }
}

function analyticsLane(): Lane {
  const queue = new TaskQueue(db, ANALYTICS_LANE, { leaseTtlSeconds: 120 });
  return {
    async seed(backlog) {
      const { workspaceId } = await fixtures.tenant();
      await analyticsTasks(workspaceId, backlog);
      return workspaceId;
    },
    async claimNext() {
      const [task] = await queue.claim({ owner: 'fairness', kinds: [ANALYTICS_PROBE] });
      return task?.workspace_id ?? null;
    },
  };
}

function siteHealthLane(): Lane {
  const queue = new TaskQueue(db, SITE_HEALTH_LANE, { leaseTtlSeconds: 120 });
  return {
    async seed(backlog) {
      const crawl = await fixtures.crawl('running');
      const ids: string[] = [];
      for (let index = 0; index < backlog.count; index += 1)
        ids.push(await fixtures.task(crawl, SITE_PROBE, { priority: backlog.priority }));
      await db
        .updateTable('site_crawl_tasks')
        .set({ available_at: backlog.availableAt })
        .where('id', 'in', ids)
        .execute();
      return crawl.workspaceId;
    },
    async claimNext() {
      const [task] = await queue.claim({ owner: 'fairness', kinds: [SITE_PROBE] });
      return task?.workspace_id ?? null;
    },
  };
}

function auditLane(): Lane {
  const queue = new AuditQueue(db, 120);
  const scopes: AuditClaimScope[] = [];
  return {
    async seed(backlog) {
      const tenant = await auditTenant(db, fixtures);
      // The tenant holds one prompt; each further prompt adds one task to the audit.
      for (let index = 1; index < backlog.count; index += 1)
        await prompt(db, tenant.setId, `Which trail shoes suit wet route ${index}?`);
      const [auditId] = await createAudits(
        db,
        tenant.workspaceId,
        auditInput.parse({
          project_id: tenant.projectId,
          prompt_set_id: tenant.setId,
          engines: ['chatgpt'],
          repetitions: 1,
        }),
        {},
        auditRuntime({}),
      );
      await db
        .updateTable('audit_tasks')
        .set({ priority: backlog.priority, available_at: backlog.availableAt })
        .where('audit_id', '=', auditId)
        .execute();
      scopes.push({ workspaceId: tenant.workspaceId, auditId });
      return tenant.workspaceId;
    },
    async claimNext() {
      const [task] = await queue.claim('fairness', 1, scopes);
      return task?.workspace_id ?? null;
    },
  };
}

function discoveryLane(): Lane {
  const worker = new DiscoveryWorker(db, { gateway: null, env: {} });
  const input = discoveryCreate.parse({
    brand_name: 'Acme',
    website_url: 'acme.com',
    primary_market: 'US',
  });
  return {
    async seed(backlog) {
      const { workspaceId } = await fixtures.tenant();
      for (let index = 0; index < backlog.count; index += 1)
        await createDiscovery(db, workspaceId, input, randomUUID());
      await db
        .updateTable('brand_discovery_tasks')
        .set({ priority: backlog.priority, available_at: backlog.availableAt })
        .where('workspace_id', '=', workspaceId)
        .execute();
      return workspaceId;
    },
    async claimNext() {
      return (await worker.claim('fairness'))?.workspace_id ?? null;
    },
  };
}

function agentLane(): Lane {
  const queue = new AgentQueue(db, 120);
  const store = agentFixtures.store();
  const workspaces: string[] = [];
  return {
    async seed(backlog) {
      const scope = await agentFixtures.scope();
      for (let index = 0; index < backlog.count; index += 1)
        await store.enqueue(scope, { message: 'Please help.', key: randomUUID() });
      await db
        .updateTable('agent_runs')
        .set({ priority: backlog.priority, available_at: backlog.availableAt })
        .where('workspace_id', '=', scope.workspaceId)
        .execute();
      workspaces.push(scope.workspaceId);
      return scope.workspaceId;
    },
    async claimNext() {
      return (await queue.claim('fairness', workspaces))?.workspace_id ?? null;
    },
  };
}

/** Grant, connection and mapping for one workspace, then `count` queued sync runs. */
async function integrationRuns(workspaceId: string, grantId: string, backlog: Backlog) {
  const projectId = await seedProject(db, workspaceId);
  const connectionId = randomUUID();
  const mappingId = randomUUID();
  const now = new Date();
  await db
    .insertInto('integration_oauth_grants')
    .values({
      id: grantId,
      workspace_id: workspaceId,
      transport: 'google_oauth',
      access_token_encrypted: 'recorded-access-token',
      refresh_token_encrypted: 'recorded-refresh-token',
      token_expires_at: new Date(Date.now() + 3_600_000),
      token_revision: 1,
      refresh_claim_id: null,
      refresh_claim_expires_at: null,
      granted_scopes: JSON.stringify(['https://www.googleapis.com/auth/webmasters.readonly']),
      status: 'connected',
      created_at: now,
      updated_at: now,
    })
    .execute();
  await db
    .insertInto('integration_connections')
    .values({
      id: connectionId,
      workspace_id: workspaceId,
      grant_id: grantId,
      provider: 'gsc',
      label: 'Recorded Search Console',
      account_ref: 'https://example.test',
      dataset_capabilities: JSON.stringify({}),
      last_synced_at: null,
      created_at: now,
      updated_at: now,
    })
    .execute();
  await db
    .insertInto('integration_property_mappings')
    .values({
      id: mappingId,
      workspace_id: workspaceId,
      connection_id: connectionId,
      provider: 'gsc',
      property_ref: 'https://example.test',
      project_id: projectId,
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    .execute();
  for (let index = 0; index < backlog.count; index += 1) {
    const runId = randomUUID();
    await db
      .insertInto('integration_sync_runs')
      .values({
        id: runId,
        workspace_id: workspaceId,
        connection_id: connectionId,
        mapping_id: mappingId,
        property_ref: 'https://example.test',
        project_id: projectId,
        sync_kind: 'on_demand',
        // One active run per mapping window, so each run covers its own day.
        window_start: new Date(Date.UTC(2026, 6, 20 + index)),
        window_end: new Date(Date.UTC(2026, 6, 21 + index)),
        resync_seq: index + 1,
        idempotency_key: `fairness-test:${runId}`,
        status: 'queued',
        priority: backlog.priority,
        randomized_position: 0,
        available_at: backlog.availableAt,
        attempt_count: 0,
        max_attempts: 4,
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: null,
        error_code: '',
        error_detail: '',
        created_at: now,
        updated_at: now,
        completed_at: null,
      })
      .execute();
  }
}

function integrationLane(): Lane {
  const workspaceByGrant = new Map<string, string>();
  let served: string | null = null;
  const client = { page: vi.fn(async () => ({ payload: { rows: [] }, rawRowCount: 0 })) };
  // The claim is private to the worker; a token is resolved for the claimed run's grant.
  const worker = new IntegrationWorker(
    db,
    client,
    { ...integrationSettings({}), sync_page_size: 2 },
    async (_db, grantId) => {
      served ??= workspaceByGrant.get(grantId) ?? `foreign:${grantId}`;
      return 'recorded-token';
    },
  );
  return {
    async seed(backlog) {
      const { workspaceId } = await fixtures.tenant();
      const grantId = randomUUID();
      workspaceByGrant.set(grantId, workspaceId);
      await integrationRuns(workspaceId, grantId, backlog);
      return workspaceId;
    },
    async claimNext() {
      served = null;
      if (!(await worker.runOnce())) return null;
      return served ?? 'claimed-without-token';
    },
  };
}

describe.each([
  { lane: 'analytics', makeLane: analyticsLane },
  { lane: 'site health', makeLane: siteHealthLane },
  { lane: 'audit', makeLane: auditLane },
  { lane: 'discovery', makeLane: discoveryLane },
  { lane: 'agent', makeLane: agentLane },
  { lane: 'integrations', makeLane: integrationLane },
])('$lane queue lane', ({ makeLane }) => {
  it('serves a quiet workspace before a busier workspace’s higher-priority backlog', async () => {
    const lane = makeLane();
    const busy = await lane.seed({
      priority: 10,
      count: 3,
      availableAt: new Date(Date.now() - 120_000),
    });
    const quiet = await lane.seed({
      priority: 0,
      count: 1,
      availableAt: new Date(Date.now() - 60_000),
    });
    const label = (workspaceId: string | null) => {
      if (workspaceId === busy) return 'busy';
      if (workspaceId === quiet) return 'quiet';
      return workspaceId;
    };

    const order: (string | null)[] = [];
    for (let claim = 0; claim < 4; claim += 1) order.push(label(await lane.claimNext()));

    expect(order).toEqual(['busy', 'quiet', 'busy', 'busy']);
    expect(label(await lane.claimNext())).toBeNull();
  });
});
