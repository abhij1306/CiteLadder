import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { prompt, promptSet } from './prompt-fixtures.ts';
import { publicApiHarness } from './public-api-support.ts';
import type { Tenant } from './visibility-fixtures.ts';
import { frozen } from './visibility-read-support.ts';

const { db, fixtures, validProjects, withApiAccess, createKey, api } = publicApiHarness();

afterEach(async () => {
  await fixtures.cleanup();
});
afterAll(async () => {
  await db.destroy();
});

async function answeredPrompt() {
  const tenant = await withApiAccess(await fixtures.tenant());
  const other = { ...tenant, projectId: await fixtures.project(tenant.workspaceId) };
  await validProjects(tenant.workspaceId);
  const promptId = await prompt(db, await promptSet(db, tenant.projectId), 'best crm');
  const otherPrompt = await prompt(db, await promptSet(db, other.projectId), 'best crm');
  const run = (owner: Tenant, day: string) =>
    fixtures.audit(owner, { completedAt: new Date(`${day}T00:00:00Z`), configuration: frozen() });
  const answer = async (owner: Tenant, auditId: string, id: string) =>
    (
      await fixtures.execution(owner, {
        auditId,
        promptId: id,
        promptIndex: 0,
        promptText: 'best crm',
      })
    ).taskId;
  const early = await run(tenant, '2026-03-02');
  const late = await run(tenant, '2026-03-09');
  const otherRun = await run(other, '2026-03-09');
  const answers = {
    early: await answer(tenant, early, promptId),
    late: await answer(tenant, late, promptId),
    other: await answer(other, otherRun, otherPrompt),
  };
  const { secret } = await createKey(tenant, { project_ids: [tenant.projectId] });
  return { tenant, other, promptId, otherPrompt, late, otherRun, answers, secret };
}

const taskIds = async (response: Response, field: 'execution_id' | 'task_id') => {
  const body = (await response.json()) as {
    items: Record<string, unknown>[];
    next_cursor: unknown;
  };
  return { ids: body.items.map((item) => item[field]), next: body.next_cursor };
};

describe('public answers', () => {
  it('pages one prompt’s answers by keyset and refuses a prompt outside the key’s project', async () => {
    const { tenant, other, promptId, otherPrompt, answers, secret } = await answeredPrompt();
    const path = `/projects/${tenant.projectId}/prompts/${promptId}/answers`;

    const first = await taskIds(await api(secret, `${path}?limit=1`), 'execution_id');
    const second = await taskIds(
      await api(secret, `${path}?limit=1&cursor=${encodeURIComponent(String(first.next))}`),
      'execution_id',
    );
    const crossed = await api(
      secret,
      `/projects/${tenant.projectId}/prompts/${otherPrompt}/answers`,
    );
    const outside = await api(
      secret,
      `/projects/${other.projectId}/prompts/${otherPrompt}/answers`,
    );

    expect([first.ids, typeof first.next, second.ids, second.next]).toEqual([
      [answers.late],
      'string',
      [answers.early],
      null,
    ]);
    expect([crossed.status, outside.status]).toEqual([404, 404]);
  });

  it('lists one run’s answers and refuses a run from another project', async () => {
    const { tenant, late, otherRun, answers, secret } = await answeredPrompt();
    const path = `/projects/${tenant.projectId}/visibility/answers`;

    const run = await taskIds(await api(secret, `${path}?audit_id=${late}`), 'task_id');
    const crossed = await api(secret, `${path}?audit_id=${otherRun}`);

    expect(run.ids).toEqual([answers.late]);
    expect(crossed.status).toBe(404);
  });
});
