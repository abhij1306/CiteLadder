/**
 * Shared OpenAPI components: every named schema an operation reaches is
 * emitted once under `components.schemas` and referenced with `$ref`. zod's
 * registry conversion writes the references; operation schemas that have no
 * name of their own stay inline.
 */
import { z } from 'zod';

import type { JsonSchema, SchemaEmitter } from './document.ts';

type Io = 'input' | 'output';
type Root = { schema: z.ZodType; io: Io };

const COMPONENT_REF = '#/components/schemas/';
/** Registry ids of unnamed operation schemas; they never reach the document. */
const OPERATION_ID = '~operation';

/** The schemas `roots` reach in one view, in traversal order. */
function reachable(roots: readonly z.ZodType[], io: Io): Set<z.core.$ZodType> {
  const reached = new Set<z.core.$ZodType>();
  for (const schema of roots)
    z.toJSONSchema(schema, {
      io,
      override: ({ zodSchema }) => {
        reached.add(zodSchema);
      },
    });
  return reached;
}

/** A schema whose request and response views differ gets a distinct request name. */
function viewName(schema: z.core.$ZodType, name: string, io: Io): string {
  if (io === 'output') return name;
  const same =
    JSON.stringify(z.toJSONSchema(schema, { io: 'input' })) ===
    JSON.stringify(z.toJSONSchema(schema, { io: 'output' }));
  return same ? name : `${name}Input`;
}

function emitView(
  roots: readonly z.ZodType[],
  io: Io,
  names: ReadonlyMap<z.core.$ZodType, string>,
  components: Record<string, JsonSchema>,
): Map<z.ZodType, JsonSchema> {
  const registry = z.registry<{ id: string }>();
  for (const schema of reachable(roots, io)) {
    const name = names.get(schema);
    if (name !== undefined) registry.add(schema, { id: viewName(schema, name, io) });
  }
  const unnamed = [...new Set(roots)].filter((schema) => !registry.has(schema));
  unnamed.forEach((schema, index) => registry.add(schema, { id: `${OPERATION_ID}${index}` }));
  const { schemas } = z.toJSONSchema(registry, { io, uri: (id) => `${COMPONENT_REF}${id}` });
  if ('__shared' in schemas)
    throw new Error('A recursive unnamed schema reaches the public API; export it as a contract');
  const emitted = new Map<z.ZodType, JsonSchema>();
  for (const schema of roots) {
    const id = registry.get(schema)?.id ?? '';
    const { $schema: _schema, $id: _id, ...body } = schemas[id] ?? {};
    if (id.startsWith(OPERATION_ID)) emitted.set(schema, body);
    else emitted.set(schema, { $ref: `${COMPONENT_REF}${id}` });
  }
  for (const [id, generated] of Object.entries(schemas)) {
    if (id.startsWith(OPERATION_ID)) continue;
    const { $schema: _schema, $id: _id, ...body } = generated;
    components[id] = body;
  }
  if (JSON.stringify([...emitted.values(), components]).includes(OPERATION_ID))
    throw new Error('An operation schema is nested in another; export it as a contract');
  return emitted;
}

/**
 * Emits `roots` with the schemas `names` names as shared components. Returns
 * the per-operation emitter and the components, sorted by name.
 */
export function componentSchemas(
  roots: readonly Root[],
  names: ReadonlyMap<z.core.$ZodType, string>,
): { emit: SchemaEmitter; components: Record<string, JsonSchema> } {
  const components: Record<string, JsonSchema> = {};
  const views = {
    input: emitView(
      roots.filter((root) => root.io === 'input').map((root) => root.schema),
      'input',
      names,
      components,
    ),
    output: emitView(
      roots.filter((root) => root.io === 'output').map((root) => root.schema),
      'output',
      names,
      components,
    ),
  };
  const emit: SchemaEmitter = (schema, io) => {
    const emitted = views[io].get(schema);
    if (emitted === undefined) throw new Error('Schema was not declared as an operation root');
    return emitted;
  };
  return {
    emit,
    components: Object.fromEntries(
      Object.entries(components).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}
