import { afterAll, expect, it } from 'vitest';
import { testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import { auditTenant, auditTestKey } from './audit-fixtures.ts';
import { seedAudit } from '../src/audits/seed.ts';
import { createAudits } from '../src/audits/creation.ts';
import { auditInput } from '../src/audits/inputs.ts';
import { auditRuntime } from '../src/audits/config.ts';
const db = testDatabase(),
  fixtures = new VisibilityFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});
it('drains only its admitted audit through deterministic execution and persists native projections', async () => {
  const t = await auditTenant(db, fixtures),
    input = auditInput.parse({
      project_id: t.projectId,
      prompt_set_id: t.setId,
      engines: ['chatgpt'],
      repetitions: 1,
    });
  const [untouched] = await createAudits(db, t.workspaceId, input, {}, auditRuntime({}));
  const id = await seedAudit(
    db,
    {
      workspace_id: t.workspaceId,
      input,
      answers: {
        'Which running shoes suit road use?': {
          answer_text: 'Acme Running is recommended.',
          search_used: false,
          citations: [],
        },
      },
    },
    auditTestKey,
  );
  expect(
    await db
      .selectFrom('audits')
      .select(['status', 'requested_count'])
      .where('id', '=', id)
      .executeTakeFirst(),
  ).toEqual({ status: 'completed', requested_count: 1 });
  expect(
    await db
      .selectFrom('audit_tasks')
      .select(['status', 'attempt_count'])
      .where('audit_id', '=', untouched)
      .executeTakeFirst(),
  ).toEqual({ status: 'queued', attempt_count: 0 });
  expect(
    await db.selectFrom('response_analyses').select('id').where('audit_id', '=', id).execute(),
  ).toHaveLength(1);
});
