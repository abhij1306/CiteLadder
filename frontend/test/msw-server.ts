import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { catalogHandler } from './provider-catalog-fixture';

const TEST_WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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
  catalogHandler(),
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
