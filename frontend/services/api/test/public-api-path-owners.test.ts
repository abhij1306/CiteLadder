import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { ROUTE_CONTRACTS } from '../src/openapi/routes.ts';
import { requirePathOwnership } from '../src/public-api/ownership.ts';
import { testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';

const db = testDatabase();
const fixtures = new VisibilityFixtures(db);

afterEach(async () => {
  await fixtures.cleanup();
});
afterAll(async () => {
  await db.destroy();
});

describe('public path ID owners', () => {
  it('fail closed on an unlisted path ID, and every public route’s path IDs are listed', async () => {
    const tenant = await fixtures.tenant();
    const check = (name: string, access: 'read' | 'write') =>
      requirePathOwnership(
        db,
        tenant.workspaceId,
        tenant.projectId,
        { project_id: tenant.projectId, [name]: randomUUID() },
        access,
      ).then(
        () => '',
        (error: Error) => error.message,
      );
    expect([await check('widget_id', 'read'), await check('widget_id', 'write')]).toEqual([
      'Public path parameter widget_id has no owner',
      'Public path parameter widget_id has no owner',
    ]);
    const names = new Set(
      ROUTE_CONTRACTS.filter((contract) => contract.exposure === 'public').flatMap((contract) =>
        [...contract.path.matchAll(/\{([a-z_]+_id)\}/gu)].map((match) => match[1]!),
      ),
    );
    const unowned = [];
    for (const name of names)
      if ((await check(name, 'read')).includes('has no owner')) unowned.push(name);
    expect([names.has('site_url_id'), unowned]).toEqual([true, []]);
  });
});
