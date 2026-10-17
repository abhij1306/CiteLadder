import {
  brandDiscoverySchema,
  brandDiscoveryCatalogSchema,
  brandDiscoveryCompleteSchema,
} from '@citeladder/contracts/visibility';

import { readBody } from '../http/body.ts';
import { randomUUID } from 'node:crypto';
import { configEnvironment } from '../config.ts';
import { DiscoveryWorker } from '../workers/discovery-worker.ts';
import { ApiError } from '../errors.ts';
import {
  completeDiscovery,
  createDiscovery,
  discoveryCatalog,
  discoveryRow,
  discoveryView,
} from '../projects/discovery.ts';
import {
  discoveryCreate,
  discoveryComplete,
  idempotencyHeaders,
} from '../projects/discovery-inputs.ts';
import { defineGetRoute, definePostRoute } from './define.ts';

const family = 'brand-discoveries';
const discoveryPath = { discovery_id: { scalar: { kind: 'uuid' }, required: true } } as const;
function key(value: string | undefined) {
  const result = idempotencyHeaders.safeParse({ 'idempotency-key': value });
  if (!result.success) throw new ApiError(422, 'A bounded, nonblank Idempotency-Key is required');
  return result.data['idempotency-key'];
}
export const brandDiscoveryRoutes = [
  defineGetRoute({
    family,
    path: '/api/v1/brand-discovery-catalog',
    authorize: 'public',
    params: { path: {}, query: {} },
    response: brandDiscoveryCatalogSchema,
    handle() {
      return Promise.resolve(discoveryCatalog());
    },
  }),
  definePostRoute({
    family,
    path: '/api/v1/brand-discoveries',
    status: 202,
    params: { path: {}, query: {} },
    body: discoveryCreate,
    headers: idempotencyHeaders,
    response: brandDiscoverySchema,
    async handle({ c, db }) {
      return createDiscovery(
        db,
        c.get('workspace').workspaceId,
        await readBody(c, discoveryCreate),
        key(c.req.header('idempotency-key')),
      );
    },
  }),
  defineGetRoute({
    family,
    path: '/api/v1/brand-discoveries/{discovery_id}',
    params: { path: discoveryPath, query: {} },
    response: brandDiscoverySchema,
    async handle({ c, db }, { path }) {
      return discoveryView(
        await discoveryRow(db, c.get('workspace').workspaceId, path.discovery_id),
      );
    },
  }),
  definePostRoute({
    family,
    path: '/api/v1/brand-discoveries/{discovery_id}/run',
    capability: 'run',
    params: { path: discoveryPath, query: {} },
    response: brandDiscoverySchema,
    async handle({ c, db, config }, { path }) {
      const workspaceId = c.get('workspace').workspaceId;
      await discoveryRow(db, workspaceId, path.discovery_id);
      const worker = new DiscoveryWorker(db, { env: configEnvironment(config) });
      await worker.runOnce(
        `interactive-discovery:${randomUUID()}`,
        { workspaceId, discoveryId: path.discovery_id },
        AbortSignal.timeout(worker.settings.interactive_timeout_seconds * 1000),
      );
      return discoveryView(await discoveryRow(db, workspaceId, path.discovery_id));
    },
  }),
  definePostRoute({
    family,
    path: '/api/v1/brand-discoveries/{discovery_id}/complete',
    params: { path: discoveryPath, query: {} },
    body: discoveryComplete,
    headers: idempotencyHeaders,
    response: brandDiscoveryCompleteSchema,
    async handle({ c, db }, { path }) {
      return completeDiscovery(
        db,
        c.get('workspace').workspaceId,
        c.get('user').id,
        path.discovery_id,
        await readBody(c, discoveryComplete),
        key(c.req.header('idempotency-key')),
      );
    },
  }),
];
