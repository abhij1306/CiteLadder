import { z } from 'zod';
import type { Selectable } from 'kysely';
import type { CrawlLogUploads } from '../generated/db-schema.ts';
import {
  crawlSourceListSchema,
  crawlTokenSchema,
  crawlReceiptSchema,
  crawlCatalogSchema,
  crawlUploadSchema,
  firehoseResponseSchema,
  crawlVerificationSchema,
  crawlSourceIdSchema,
} from '@citeladder/contracts/ai-traffic';
import { defineGetRoute, definePostRoute } from './define.ts';
import { readBody } from '../http/body.ts';
import { requireProject } from '../projects/access.ts';
import { crawlers } from '../config/crawlers.ts';
import { crawlLogs } from '../config/crawl-logs.ts';
import { policy } from '../config.ts';
import { ApiError, notFound } from '../errors.ts';
import { sourceList } from '../crawl-logs/source-reads.ts';
import {
  createSource,
  createSourceSchema,
  mutateSource,
  authorizeToken,
  requireCrawlLogs,
  pullSourceFor,
  confirmSinkFilter,
} from '../crawl-logs/sources.ts';
import { requirePubSubReader } from '../crawl-logs/gcp-client.ts';
import { verifyPullSource } from '../crawl-logs/gcp-verify.ts';
import { ingest, boundedBody, batchQuota, answeredReceipt } from '../crawl-logs/ingest.ts';
import { firehoseDelivery } from '../crawl-logs/firehose.ts';
import { lockAuthorizedWorkspace } from '../workspaces/service.ts';
import {
  createUpload,
  completeUpload,
  sourceForUpload,
  uploadCreateSchema,
  uploadBatchSchema,
  uploadCompleteSchema,
} from '../crawl-logs/uploads.ts';

const root = '/api/v1/projects/{project_id}/crawl-logs';
/** Machine routes: called by log senders, never by the browser app. */
const ingestPath = policy.api.machine_prefix + '/crawl-logs/ingest/{source_id}';
const firehosePath = policy.api.machine_prefix + '/crawl-logs/firehose/{source_id}';
const uploadBatchPath = root + '/sources/{source_id}/uploads/{upload_id}/batches';
const selfBounded = [ingestPath, firehosePath, uploadBatchPath].map((template) =>
  template.split('/'),
);
const matchesTemplate = (template: string[], segments: string[]) =>
  template.length === segments.length &&
  template.every((part, i) => (part.startsWith('{') ? segments[i] !== '' : part === segments[i]));
/**
 * POST routes that authenticate and spend attempt quota before streaming their
 * own compressed/decompressed body bound; the app must not pre-read them.
 */
export function streamsOwnBody(method: string, path: string) {
  if (method !== 'POST') return false;
  const segments = path.split('/');
  return selfBounded.some((template) => matchesTemplate(template, segments));
}
const path = { project_id: { scalar: { kind: 'uuid' }, required: true } } as const;
const sourcePath = { ...path, source_id: { scalar: { kind: 'uuid' }, required: true } } as const;
const uploadPath = {
  ...sourcePath,
  upload_id: { scalar: { kind: 'uuid' }, required: true },
} as const;
const base = { family: 'crawl-logs', authorize: 'project' } as const;
const writes = { ...base, capability: 'manage_credentials' } as const;
const scope = (workspaceId: string, projectId: string) => ({ workspaceId, projectId });
const uploadView = (row: Selectable<CrawlLogUploads>) =>
  crawlUploadSchema.parse({ ...row, created_at: row.created_at.toISOString() });
export const crawlLogRoutes = [
  defineGetRoute({
    ...base,
    path: root + '/catalog',
    params: { path, query: {} },
    response: crawlCatalogSchema,
    async handle({ c, db }, { path }) {
      await requireProject(db, c.get('workspace'), path.project_id);
      return {
        catalog_version: crawlers.catalog_version,
        bots: crawlers.bots,
        presets: crawlLogs.presets,
        max_batch_bytes: crawlLogs.max_batch_bytes,
        max_lines_per_batch: crawlLogs.max_lines_per_batch,
        upload_sample_lines: crawlLogs.upload_sample_lines,
        max_line_bytes: crawlLogs.max_line_bytes,
        max_backdate_days: crawlLogs.max_backdate_days,
        worker_timeout_ms: crawlLogs.worker_timeout_ms,
      };
    },
  }),
  defineGetRoute({
    ...base,
    path: root + '/sources',
    params: { path, query: {} },
    response: crawlSourceListSchema,
    async handle({ c, db }, { path }) {
      await requireProject(db, c.get('workspace'), path.project_id);
      return sourceList(db, scope(c.get('workspace').workspaceId, path.project_id));
    },
  }),
  definePostRoute({
    ...writes,
    path: root + '/sources',
    params: { path, query: {} },
    body: createSourceSchema,
    response: crawlTokenSchema,
    handle: async ({ c, db }, { path }) =>
      createSource(
        db,
        scope(c.get('workspace').workspaceId, path.project_id),
        c.get('user').id,
        await readBody(c, createSourceSchema),
      ),
  }),
  definePostRoute({
    ...writes,
    path: root + '/sources/{source_id}/verify',
    params: { path: sourcePath, query: {} },
    response: crawlVerificationSchema,
    async handle({ c, db }, { path }) {
      const target = scope(c.get('workspace').workspaceId, path.project_id);
      const actorId = c.get('user').id;
      requireCrawlLogs();
      // Authority is checked before the Google call and again when its outcome is written.
      await db
        .transaction()
        .execute((trx) =>
          lockAuthorizedWorkspace(trx, target.workspaceId, actorId, 'manage_credentials'),
        );
      const source = await pullSourceFor(db, target, path.source_id);
      const reader = requirePubSubReader();
      const outcome = await verifyPullSource(db, source, reader, { actorId });
      return { id: source.id, ...outcome };
    },
  }),
  definePostRoute({
    ...writes,
    path: root + '/sources/{source_id}/filter-confirmation',
    params: { path: sourcePath, query: {} },
    response: crawlSourceIdSchema,
    handle: ({ c, db }, { path }) =>
      confirmSinkFilter(
        db,
        scope(c.get('workspace').workspaceId, path.project_id),
        c.get('user').id,
        path.source_id,
      ),
  }),
  ...(['rotate', 'revoke'] as const).map((action) =>
    definePostRoute({
      ...writes,
      path: root + '/sources/{source_id}/' + action,
      params: { path: sourcePath, query: {} },
      response: crawlTokenSchema,
      handle: ({ c, db }, { path }) =>
        mutateSource(
          db,
          scope(c.get('workspace').workspaceId, path.project_id),
          c.get('user').id,
          path.source_id,
          action,
        ),
    }),
  ),
  definePostRoute({
    family: 'crawl-log-ingest',
    authorize: 'public',
    raw: true,
    path: ingestPath,
    params: { path: { source_id: sourcePath.source_id }, query: {} },
    response: crawlReceiptSchema,
    status: 202,
    headers: z.object({
      authorization: z.string().optional(),
      'idempotency-key': z.string().optional(),
      'content-encoding': z.string().optional(),
    }),
    async handle({ c, db }, { path }) {
      const source = await authorizeToken(db, path.source_id, c.req.header('authorization'));
      // The media type is checked first, so a refused request spends no batch attempt.
      const type = c.req.header('content-type')?.split(';')[0];
      if (
        type &&
        ![
          'application/json',
          'application/x-ndjson',
          'text/plain',
          'application/gzip',
          'application/octet-stream',
        ].includes(type)
      )
        throw new ApiError(415, 'Unsupported log media type');
      const stored = await batchQuota(db, source, new Date(), c.req.header('idempotency-key'));
      // A retried key spent no quota, so it is answered without reading the body.
      const receipt = stored
        ? answeredReceipt(stored)
        : await ingest(db, source, await boundedBody(c.req.raw), {
            key: c.req.header('idempotency-key'),
            encoding: c.req.header('content-encoding'),
            tokenHash: source.token_hash!,
            quotaChecked: true,
            accessChecked: true,
          });
      return c.json(crawlReceiptSchema.parse(receipt), 202);
    },
  }),
  definePostRoute({
    family: 'crawl-log-ingest',
    authorize: 'public',
    raw: true,
    path: firehosePath,
    params: { path: { source_id: sourcePath.source_id }, query: {} },
    response: firehoseResponseSchema,
    status: 200,
    headers: z.object({
      'x-amz-firehose-request-id': z.string().optional(),
      'x-amz-firehose-access-key': z.string().optional(),
      'content-encoding': z.string().optional(),
    }),
    handle: ({ c, db }, { path }) =>
      firehoseDelivery(
        db,
        path.source_id,
        {
          requestId: c.req.header('x-amz-firehose-request-id'),
          accessKey: c.req.header('x-amz-firehose-access-key'),
          encoding: c.req.header('content-encoding'),
        },
        c.req.raw,
      ),
  }),
  definePostRoute({
    ...writes,
    path: root + '/sources/{source_id}/uploads',
    params: { path: sourcePath, query: {} },
    body: uploadCreateSchema,
    response: crawlUploadSchema,
    handle: async ({ c, db }, { path }) =>
      createUpload(
        db,
        scope(c.get('workspace').workspaceId, path.project_id),
        path.source_id,
        await readBody(c, uploadCreateSchema),
        c.get('user').id,
      ).then(uploadView),
  }),
  defineGetRoute({
    ...base,
    path: root + '/sources/{source_id}/uploads/{upload_id}',
    params: { path: uploadPath, query: {} },
    response: crawlUploadSchema,
    async handle({ c, db }, { path }) {
      await requireProject(db, c.get('workspace'), path.project_id);
      const upload = await db
        .selectFrom('crawl_log_uploads')
        .selectAll()
        .where('workspace_id', '=', c.get('workspace').workspaceId)
        .where('project_id', '=', path.project_id)
        .where('source_id', '=', path.source_id)
        .where('id', '=', path.upload_id)
        .executeTakeFirst();
      if (!upload) throw notFound('Upload');
      return uploadView(upload);
    },
  }),
  definePostRoute({
    ...writes,
    path: uploadBatchPath,
    params: { path: uploadPath, query: {} },
    body: uploadBatchSchema,
    response: crawlReceiptSchema,
    async handle({ c, db }, { path }) {
      const target = scope(c.get('workspace').workspaceId, path.project_id);
      requireCrawlLogs();
      // Recheck current credential authority before accepting client evidence.
      await db
        .transaction()
        .execute((trx) =>
          lockAuthorizedWorkspace(trx, target.workspaceId, c.get('user').id, 'manage_credentials'),
        );
      const source = await sourceForUpload(db, target, path.source_id);
      let value: unknown;
      try {
        value = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(await boundedBody(c.req.raw)),
        );
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(422, 'Invalid upload batch');
      }
      const input = uploadBatchSchema.safeParse(value);
      if (!input.success) throw new ApiError(422, 'Invalid upload batch');
      const key = path.upload_id + ':' + input.data.seq;
      // A retried, already-accepted sequence spends no attempt quota.
      const stored = await batchQuota(db, source, new Date(), key);
      if (stored) return answeredReceipt(stored);
      return ingest(db, source, Buffer.from(input.data.lines.join('\n')), {
        key,
        uploadId: path.upload_id,
        seq: input.data.seq,
        actorId: c.get('user').id,
        quotaChecked: true,
      });
    },
  }),
  definePostRoute({
    ...writes,
    path: root + '/sources/{source_id}/uploads/{upload_id}/complete',
    params: { path: uploadPath, query: {} },
    body: uploadCompleteSchema,
    response: crawlUploadSchema,
    handle: async ({ c, db }, { path }) =>
      completeUpload(
        db,
        scope(c.get('workspace').workspaceId, path.project_id),
        path.source_id,
        path.upload_id,
        await readBody(c, uploadCompleteSchema),
        c.get('user').id,
      ).then(uploadView),
  }),
];
