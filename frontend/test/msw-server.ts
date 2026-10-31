import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

/**
 * The workspace every test account belongs to, unless a test says otherwise.
 */
const TEST_WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * Membership is a precondition of the authenticated shell, not a feature of
 * any one screen: `ProjectProvider` resolves which workspace it is in before
 * it can scope a single request. Answering it by default means a screen test
 * exercises the screen rather than re-declaring the account it runs in, and
 * `onUnhandledFrame: 'error'` keeps its bite for everything else. A test
 * about workspaces overrides this with `server.use(...)`.
 */
const defaultHandlers = [
  http.get('/api/v1/workspaces', () =>
    HttpResponse.json([
      {
        id: TEST_WORKSPACE_ID,
        name: 'Test Workspace',
        role: 'owner',
        // The response now publishes the role's effective capabilities, and
        // the contract is strict — a row without them fails validation, which
        // is exactly the shell's "workspace could not be loaded" state.
        capabilities: ['manage_credentials', 'read', 'run', 'write'],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]),
  ),
];

/**
 * Shared MSW server for frontend tests. Handlers are registered per-test
 * via `server.use(...)`; the lifecycle hooks (listen/reset/close) are wired in
 * each test file so a suite that doesn't import this never starts a server.
 *
 * The API client calls the relative base `/api/v1`; jsdom resolves relative
 * URLs against the configured origin, so handlers match `/api/v1/...` paths.
 */
export const mswServer = setupServer(...defaultHandlers);
