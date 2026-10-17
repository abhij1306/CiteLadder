/** Owner/Admin management of the active workspace's public API keys. */
import {
  apiKeyCreateSchema,
  apiKeyCreatedSchema,
  apiKeyListSchema,
  apiKeySchema,
} from '@citeladder/contracts/api-keys';

import { createApiKey, listApiKeys, revokeApiKey } from '../api-keys/keys.ts';
import { readBody } from '../http/body.ts';
import { defineGetRoute, definePostRoute, type ProductRoute } from './define.ts';

const root = '/api/v1/api-keys';
const keys = { family: 'api-keys', capability: 'manage_credentials' } as const;

export const API_KEY_ROUTES: readonly ProductRoute[] = [
  defineGetRoute({
    ...keys,
    path: root,
    params: { path: {}, query: {} },
    response: apiKeyListSchema,
    handle: ({ c, db }) => listApiKeys(db, c.get('workspace').workspaceId),
  }),
  definePostRoute({
    ...keys,
    path: root,
    status: 201,
    params: { path: {}, query: {} },
    body: apiKeyCreateSchema,
    response: apiKeyCreatedSchema,
    handle: async ({ c, db, config }) =>
      createApiKey(
        db,
        config.auth.apiKeyPepper,
        c.get('workspace').workspaceId,
        c.get('user'),
        await readBody(c, apiKeyCreateSchema),
      ),
  }),
  definePostRoute({
    ...keys,
    path: `${root}/{key_id}/revoke`,
    params: { path: { key_id: { scalar: { kind: 'uuid' }, required: true } }, query: {} },
    response: apiKeySchema,
    handle: ({ c, db }, { path }) =>
      revokeApiKey(db, c.get('workspace').workspaceId, c.get('user').id, path.key_id),
  }),
];
