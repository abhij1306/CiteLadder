import { z } from 'zod';
import { catalogImportRequestSchema } from '@citeladder/contracts/commerce-requests';
import { applyImport, stageImport } from '../commerce/import.ts';
import { importPrompts, PROMPTS_WRITE } from '../commands/prompts.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import { brandFactImport, importBrandFacts } from '../projects/brand-facts.ts';
import { promptImport } from '../prompts/prompts.ts';
import { changeKind, MEMBER_RUN, MEMBER_WRITE, plural, rowsOf } from './kind.ts';
import { promptSetName } from './prompt-kinds.ts';

type Scope = Readonly<{ workspaceId: string; projectId: string }>;

const EXAMPLES = 3;
const NOTES = 5;

const promptsPayload = z.strictObject({
  prompt_set_id: z.uuid(),
  prompts: promptImport.shape.prompts.min(1),
});

const [csvSource, merchantSource] = catalogImportRequestSchema.options;
const catalogPayload = z
  .discriminatedUnion('source', [csvSource, merchantSource])
  .refine((body) => Buffer.byteLength(body.content, 'utf8') <= policy.commerce.import_max_bytes, {
    message: 'The file exceeds the byte limit',
    path: ['content'],
  });

const bindingRows = z.object({
  rows: z.array(z.object({ row: z.number().int(), message: z.string() })).min(1),
});

function nothingImported(): never {
  throw new ApiError(422, 'Every row is already there or invalid, so nothing would be imported');
}

function withBindingRows(error: unknown): never {
  const failed = error instanceof ApiError ? bindingRows.safeParse(error.details) : null;
  if (!(error instanceof ApiError) || !failed?.success) throw error;
  const rows = failed.data.rows.slice(0, NOTES).map((row) => `row ${row.row + 1}: ${row.message}`);
  throw new ApiError(error.status, `${error.message.replace(/\.$/u, '')} (${rows.join('; ')})`, {
    code: error.code,
  });
}

async function promptIds(trx: Database, scope: Scope, promptSetId: string) {
  return trx
    .selectFrom('prompts')
    .innerJoin('prompt_sets', 'prompt_sets.id', 'prompts.prompt_set_id')
    .select(['prompts.id', 'prompts.text'])
    .where('prompt_sets.workspace_id', '=', scope.workspaceId)
    .where('prompt_sets.project_id', '=', scope.projectId)
    .where('prompts.prompt_set_id', '=', promptSetId)
    .execute();
}

async function productNames(trx: Database, scope: Scope, ids: readonly string[]) {
  if (!ids.length) return [];
  const rows = await trx
    .selectFrom('commerce_products')
    .select('name')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', 'in', ids)
    .orderBy('name')
    .execute();
  return rows.map((row) => row.name);
}

const countRow = (label: string, count: number) =>
  count > 0 ? [{ label, value: String(count) }] : [];

export const importKinds = {
  import_prompts: changeKind({
    permission: PROMPTS_WRITE,
    purpose:
      'import prompts the person gave in a file or pasted text into a prompt set; rows already tracked are skipped',
    payload: promptsPayload,
    async execute(trx, _config, actor, change, payload) {
      const scoped = { workspaceId: actor.workspaceId, projectId: change.projectId };
      const before = new Set(
        (await promptIds(trx, scoped, payload.prompt_set_id)).map((row) => row.id),
      );
      const body = { prompts: payload.prompts };
      await importPrompts(trx, actor, change.projectId, payload.prompt_set_id, {
        bytes: Buffer.byteLength(JSON.stringify(body), 'utf8'),
        read: () => Promise.resolve(body),
      }).catch(withBindingRows);
      const after = await promptIds(trx, scoped, payload.prompt_set_id);
      const added = new Set(after.filter((row) => !before.has(row.id)).map((row) => row.text));
      const created = [...new Set(payload.prompts.map((row) => row.text))].filter((text) =>
        added.has(text),
      );
      const empty = payload.prompts.filter((row) => !row.text).length;
      return {
        summary: `Imported ${plural(created.length, 'prompt')}.`,
        created,
        empty,
        skipped: payload.prompts.length - created.length - empty,
      };
    },
    async preview(context, payload, rehearse) {
      const { created, empty, skipped } = await rehearse();
      if (!created.length) nothingImported();
      return {
        title: `Import ${plural(created.length, 'prompt')}`,
        rows: [
          { label: 'Prompt set', value: await promptSetName(context, payload.prompt_set_id) },
          { label: 'Rows given', value: String(payload.prompts.length) },
          ...countRow('Skipped, already tracked or repeated', skipped),
          ...countRow('Skipped, no prompt text', empty),
          ...rowsOf('Example', created.slice(0, EXAMPLES)),
        ],
        spend: null,
        opens: null,
      };
    },
  }),
  import_brand_facts: changeKind({
    permission: MEMBER_WRITE,
    purpose:
      'import company facts for fact checking from what the person gave; they land as drafts the person reviews, and duplicates are skipped',
    payload: brandFactImport,
    async execute(trx, _config, actor, change, payload) {
      const { rows } = await importBrandFacts(
        trx,
        { workspaceId: actor.workspaceId, projectId: change.projectId },
        actor.userId,
        payload,
      );
      const created = rows.filter((row) => row.kind === 'created').length;
      return {
        summary: `Imported ${plural(created, 'fact')} as drafts.`,
        created,
        duplicates: rows.filter((row) => row.kind === 'duplicate').length,
        invalid: rows.flatMap((row) =>
          row.kind === 'invalid' ? [`Row ${row.index + 1}: ${row.message}`] : [],
        ),
        examples: rows.flatMap((row) =>
          row.kind === 'created' ? [payload.rows[row.index]?.statement ?? ''] : [],
        ),
      };
    },
    async preview(_context, payload, rehearse) {
      const { created, duplicates, invalid, examples } = await rehearse();
      if (!created) nothingImported();
      return {
        title: `Import ${plural(created, 'fact')} as drafts`,
        rows: [
          { label: 'Rows given', value: String(payload.rows.length) },
          ...countRow('Skipped, already a fact', duplicates),
          ...countRow('Rejected', invalid.length),
          ...rowsOf('Rejected row', invalid.slice(0, NOTES)),
          ...rowsOf('Example', examples.slice(0, EXAMPLES)),
        ],
        spend: null,
        opens: null,
      };
    },
  }),
  import_catalog: changeKind({
    permission: MEMBER_RUN,
    purpose:
      'import products into the catalog from a CSV you write in the catalog template columns (title, brand, description, price, currency, link, image_link, category, sku, gtin; title and brand required), or a Merchant Center feed the person gave as is',
    payload: catalogPayload,
    async execute(trx, _config, actor, change, payload) {
      const scope = { workspaceId: actor.workspaceId, projectId: change.projectId };
      const staged = await stageImport(trx, scope, {
        format: payload.source,
        content: payload.content,
        label: payload.filename,
      });
      if (staged.result)
        throw new ApiError(409, 'This exact file was already imported into the catalog');
      const result = await applyImport(trx, scope, staged.import_id, []);
      const written = result.row_outcomes.filter(
        (row) => row.status === 'created' || row.status === 'updated',
      );
      return {
        summary: `Imported the catalog: ${result.created} new, ${result.updated} updated, ${result.rejected} rejected.`,
        result,
        examples: await productNames(
          trx,
          scope,
          written.slice(0, EXAMPLES).flatMap((row) => (row.product_id ? [row.product_id] : [])),
        ),
      };
    },
    async preview(_context, payload, rehearse) {
      const { result, examples } = await rehearse();
      if (!result.created && !result.updated) nothingImported();
      const rejected = result.row_outcomes.filter((row) => row.status === 'rejected');
      return {
        title: `Import ${plural(result.created + result.updated, 'product')} into the catalog`,
        rows: [
          { label: 'File', value: payload.filename },
          ...countRow('New', result.created),
          ...countRow('Updated', result.updated),
          ...countRow('Unchanged', result.unchanged),
          ...countRow('Rejected', result.rejected),
          ...rowsOf(
            'Rejected row',
            rejected.slice(0, NOTES).map((row) => `Row ${row.row_number}: ${row.detail}`),
          ),
          ...rowsOf('Example', examples),
        ],
        spend: null,
        opens: null,
      };
    },
  }),
};
