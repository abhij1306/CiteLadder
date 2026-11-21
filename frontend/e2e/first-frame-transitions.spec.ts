import { expect, test, type Page } from '@playwright/test';

import { makeProject } from '../test/fixtures/project';
import { FIXTURE_PROJECT, FIXTURE_WORKSPACE_ID, stubAuthedShell } from './helpers/app-fixture';

const TERMS = { terms_revision: '2026-09-24', privacy_notice_revision: '2026-09-24' };
const USER = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'shell@example.com',
  role: 'owner',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const FLOW_PATHS = new Set([
  '/login',
  '/register',
  '/workspaces',
  '/onboarding',
  '/invitations/accept',
]);
const BETA_WORKSPACE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BETA_PROJECT = makeProject({
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  workspace_id: BETA_WORKSPACE_ID,
  name: 'Beta',
  brand_name: 'Beta',
  website_url: 'https://beta.example',
});

type Frame = {
  doc: string;
  path: string;
  search: string;
  surfaces: number;
  shell: string | null;
  rootChildren: number;
  bootShell: boolean;
};

type Recorder = {
  frames: Frame[];
  next: (match: (frame: Frame) => boolean) => Promise<Frame>;
};

async function recordFrames(page: Page): Promise<Recorder> {
  const frames: Frame[] = [];
  const waiting: Array<{ match: (frame: Frame) => boolean; found: (frame: Frame) => void }> = [];
  await page.exposeBinding('__recordFrame', (_source, frame: Frame) => {
    frames.push(frame);
    for (const waiter of waiting.filter((entry) => entry.match(frame))) {
      waiting.splice(waiting.indexOf(waiter), 1);
      waiter.found(frame);
    }
  });
  const next = (match: (frame: Frame) => boolean) => {
    const seen = frames.find(match);
    return seen
      ? Promise.resolve(seen)
      : new Promise<Frame>((found) => {
          waiting.push({ match, found });
        });
  };
  await page.addInitScript(() => {
    const doc = Math.random().toString(36).slice(2);
    const ids = new WeakMap<Element, string>();
    let last = '';
    const sample = () => {
      const root = document.getElementById('root');
      if (root) {
        const surface = document.querySelector('[data-app-surface]');
        if (surface && !ids.has(surface)) ids.set(surface, `${doc}:${Math.random()}`);
        const frame = {
          doc,
          path: location.pathname,
          search: location.search,
          surfaces: document.querySelectorAll('[data-app-surface]').length,
          shell: surface ? (ids.get(surface) ?? null) : null,
          rootChildren: root.childElementCount,
          bootShell: root.querySelector('.boot-shell')?.hasAttribute('data-boot-shell') ?? false,
        };
        const key = JSON.stringify(frame);
        const record = (window as unknown as { __recordFrame?: (value: unknown) => void })
          .__recordFrame;
        if (key !== last && record) {
          last = key;
          record(frame);
        }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  return { frames, next };
}

function expectFlowFramesPlain(frames: readonly Frame[]) {
  const wrong = frames.filter(
    (frame) => FLOW_PATHS.has(frame.path) && (frame.surfaces || frame.bootShell),
  );
  expect(wrong).toEqual([]);
  expect(frames.filter((frame) => frame.rootChildren === 0)).toEqual([]);
  expect(frames.filter((frame) => frame.surfaces > 1)).toEqual([]);
}

async function stubSignIn(
  page: Page,
  memberships: ReadonlyArray<{ id: string; name: string; role: string }>,
) {
  let signedIn = false;
  await stubAuthedShell(page, [], [FIXTURE_PROJECT, BETA_PROJECT]);
  await page.route('**/api/v1/workspaces', (route) =>
    route.fulfill({
      json: memberships.map((workspace) => ({
        ...workspace,
        capabilities: ['manage_billing', 'manage_members', 'read', 'run', 'write'],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      })),
    }),
  );
  await page.route('**/api/v1/projects', (route) =>
    route.fulfill({
      json: [FIXTURE_PROJECT, BETA_PROJECT].filter(
        (project) => project.workspace_id === route.request().headers()['x-workspace-id'],
      ),
    }),
  );
  await page.route('**/api/v1/auth/policies', (route) => route.fulfill({ json: TERMS }));
  await page.route('**/api/v1/auth/terms', (route) =>
    route.fulfill({ json: { ...TERMS, accepted_at: '2026-01-01T00:00:00Z' } }),
  );
  await page.route('**/api/v1/auth/me', (route) =>
    signedIn
      ? route.fulfill({ json: { user: USER } })
      : route.fulfill({ status: 401, json: { error: { message: 'Not authenticated' } } }),
  );
  await page.route('**/api/v1/auth/login', (route) => {
    signedIn = true;
    return route.fulfill({ json: { user: USER } });
  });
  await page.route('**/api/v1/auth/logout', (route) => {
    signedIn = false;
    return route.fulfill({ status: 204 });
  });
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/^Email address/u).fill(USER.email);
  await page.getByLabel(/^Password/u).fill('correct-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
}

const accountMenu = (page: Page) => page.getByRole('button', { name: /^Account menu for/u });

test('a single-workspace owner signs in to one shell and signs out to a plain sign-in page', async ({
  page,
}) => {
  const { frames, next } = await recordFrames(page);
  await stubSignIn(page, [{ id: FIXTURE_WORKSPACE_ID, name: 'Alpha', role: 'owner' }]);
  await signIn(page);
  await expect(page).toHaveURL(/\/projects\?.*project=/u);
  await expect(accountMenu(page)).toBeVisible();
  const app = (await next((f) => f.path === '/projects' && f.shell !== null)).doc;
  expect(new Set(frames.filter((f) => f.doc === app && f.shell).map((f) => f.shell)).size).toBe(1);

  await accountMenu(page).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  await next((f) => f.path === '/login' && f.doc !== app);
  expectFlowFramesPlain(frames);
});

test('the chooser opens on its plain frame and a workspace switch keeps the shell', async ({
  page,
}) => {
  const { frames, next } = await recordFrames(page);
  await stubSignIn(page, [
    { id: FIXTURE_WORKSPACE_ID, name: 'Alpha', role: 'owner' },
    { id: BETA_WORKSPACE_ID, name: 'Beta team', role: 'admin' },
  ]);
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Choose a workspace' })).toBeVisible();
  await page.getByRole('button', { name: /Alpha/u }).click();
  await expect(accountMenu(page)).toBeVisible();

  const entered = await next((f) => f.path === '/projects' && f.shell !== null);
  const start = frames.indexOf(entered);
  await page
    .getByRole('button', { name: FIXTURE_PROJECT.brand_name ?? FIXTURE_PROJECT.name })
    .click();
  await page.getByRole('menuitem', { name: 'Beta team' }).click();
  await expect(page).toHaveURL(new RegExp(`project=${BETA_PROJECT.id}`, 'u'));
  await expect(page.getByRole('button', { name: 'Beta', exact: true })).toBeVisible();
  await next((f) => f.search.includes(BETA_PROJECT.id));
  const during = frames.slice(start);
  expect([...new Set(during.map((frame) => frame.doc))]).toEqual([entered.doc]);
  expect([...new Set(during.map((frame) => frame.shell))]).toEqual([entered.shell]);
  expectFlowFramesPlain(frames);
});

test('someone with no workspace signs in to setup with only flow frames before its card', async ({
  page,
}) => {
  const { frames, next } = await recordFrames(page);
  await stubSignIn(page, []);
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();
  const setup = await next((f) => f.path === '/onboarding');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();
  await next((f) => f.path === '/onboarding' && f.doc !== setup.doc);
  expectFlowFramesPlain(frames);
});
