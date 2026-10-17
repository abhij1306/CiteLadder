import type { Page } from '@playwright/test';

import { makeProject } from '../../test/fixtures/project';

/**
 * Application-shell network fixture for e2e + visual specs.
 *
 * `SessionGuard` calls `GET /api/v1/auth/me` for the local user,
 * `ProjectProvider` calls `GET /api/v1/workspaces` and `GET /api/v1/projects`
 * plus the selected project detail. The workspace list is what resolves the
 * shell's workspace — it is answered independently of any project, because a
 * workspace with none is still a workspace. Stubbing those endpoints is the
 * whole "one project" arrangement.
 */
const FIXTURE_USER = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'shell@example.com',
  role: 'owner',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as const;

/** The workspace every fixture account belongs to. */
export const FIXTURE_WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * The shell's one project.
 *
 * Built from the vitest `makeProject` fixture so the `Project` SHAPE has a
 * single definition across both suites: this file used to hand-write the same
 * twenty fields and had already drifted from it on `website_url`, `industry`
 * and `primary_market`. The overrides below are the values the e2e specs
 * actually render, and are the only intentional differences.
 */
export const FIXTURE_PROJECT = makeProject({
  workspace_id: FIXTURE_WORKSPACE_ID,
  website_url: 'https://acme.example',
  industry: 'general',
  primary_market: 'United States',
});

/** Build the canonical project-owned URL used by authenticated browser journeys. */
export function fixtureProjectPath(href: string): string {
  const target = new URL(href, 'https://citeladder.test');
  target.searchParams.set('project', FIXTURE_PROJECT.id);
  return `${target.pathname}?${target.searchParams.toString()}`;
}

/**
 * Stub the two shell endpoints, plus a 404 catch-all for everything else
 * under `/api/v1/`. The catch-all is what makes screenshots deterministic:
 * 4xx never retries (lib/api/query-client.ts), so every unstubbed data query
 * settles into its empty/error state in ONE attempt instead of flapping
 * between skeleton and error across the two-retry window. It is also what
 * keeps an unstubbed downstream call (GettingStartedCard's audits query)
 * from falling through to a live backend.
 *
 * Playwright matches routes in reverse registration order, so register the
 * catch-all FIRST and the specific stubs after it; the last-registered
 * matching route wins. `stubs` lets a spec layer its own endpoints on top.
 */
/** One membership row per workspace the fixture projects belong to. */
function workspacesFor(projects: ReadonlyArray<typeof FIXTURE_PROJECT>) {
  const ids = new Set(projects.map((project) => project.workspace_id));
  if (ids.size === 0) ids.add(FIXTURE_WORKSPACE_ID);
  return membershipRows([...ids]);
}

function membershipRows(ids: readonly string[]) {
  return ids.map((id) => ({
    id,
    name: 'Fixture Workspace',
    role: 'owner',
    // The Owner's effective capabilities, as the backend's one role policy
    // publishes them. The shell gates controls on these names.
    capabilities: ['delete_projects', 'manage_credentials', 'read', 'run', 'write'],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }));
}

export async function stubAuthedShell(
  page: Page,
  stubs: ReadonlyArray<readonly [string | RegExp, unknown]> = [],
  projects: ReadonlyArray<typeof FIXTURE_PROJECT> = [FIXTURE_PROJECT],
): Promise<void> {
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'e2e fixture: endpoint not stubbed' } }),
    }),
  );
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: { user: FIXTURE_USER } }));
  // Answered even when `projects` is empty: the shell resolves its workspace
  // from here, not from a project, so an empty account still has a workspace to
  // scope its reads against.
  await page.route('**/api/v1/workspaces', (route) =>
    route.fulfill({ json: workspacesFor(projects) }),
  );
  await page.route('**/api/v1/projects', (route) => route.fulfill({ json: projects }));
  for (const project of projects) {
    await page.route(`**/api/v1/projects/${project.id}`, (route) =>
      route.fulfill({ json: project }),
    );
  }
  for (const [pattern, body] of stubs) {
    await page.route(pattern, (route) => route.fulfill({ json: body }));
  }
}
