import type { JsonSchema } from '../openapi/document.ts';

const REF_PREFIX = '#/components/schemas/';
const MAX_DEPTH = 6;

const STRING_FORMATS: Record<string, string> = {
  'date-time': '2026-01-15T09:30:00.000Z',
  date: '2026-01-15',
  uri: 'https://example.com/page',
  url: 'https://example.com/page',
  email: 'person@example.com',
};

export type ExampleContext = {
  components: Readonly<Record<string, JsonSchema>>;
  io: 'input' | 'output';
};

type Walk = (node: JsonSchema, depth: number, key: string) => unknown;

function fakeUuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function variantsOf(schema: JsonSchema): JsonSchema[] | undefined {
  return (schema.anyOf ?? schema.oneOf) as JsonSchema[] | undefined;
}

function nullable(schema: JsonSchema): boolean {
  return (
    (Array.isArray(schema.type) && schema.type.includes('null')) ||
    schema.type === 'null' ||
    (variantsOf(schema)?.some((variant) => variant.type === 'null') ?? false)
  );
}

function stringExample(node: JsonSchema, key: string, nextId: () => string): string {
  if (node.format === 'uuid') return nextId();
  const format = typeof node.format === 'string' ? STRING_FORMATS[node.format] : undefined;
  if (format) return format;
  if (/(^|_)(url|link)$/.test(key)) return STRING_FORMATS.url ?? 'https://example.com';
  if (/(^|_)domains?$/.test(key)) return 'example.com';
  if (key.endsWith('_at')) return STRING_FORMATS['date-time'] ?? '';
  return key ? `Example ${key.replaceAll('_', ' ')}` : 'example';
}

function fixedValue(node: JsonSchema): { value: unknown } | undefined {
  if (node.const !== undefined) return { value: node.const };
  if (node.default !== undefined && node.default !== null) return { value: node.default };
  if (Array.isArray(node.enum)) return { value: node.enum[0] };
  return undefined;
}

function numberExample(node: JsonSchema): number {
  const preferred = typeof node.minimum === 'number' && node.minimum > 0 ? node.minimum : 1;
  return typeof node.maximum === 'number' ? Math.min(preferred, node.maximum) : preferred;
}

function shownProperties(node: JsonSchema, io: ExampleContext['io']) {
  const properties = Object.entries((node.properties ?? {}) as Record<string, JsonSchema>);
  if (io === 'output') return properties;
  const required = new Set((node.required ?? []) as string[]);
  return properties.filter(
    ([name], index) => required.has(name) || (required.size === 0 && index === 0),
  );
}

function resolved(node: JsonSchema, components: ExampleContext['components']): JsonSchema {
  return typeof node.$ref === 'string' && node.$ref.startsWith(REF_PREFIX)
    ? (components[node.$ref.slice(REF_PREFIX.length)] ?? node)
    : node;
}

function objectExample(node: JsonSchema, context: ExampleContext, walk: Walk, depth: number) {
  const shown = shownProperties(node, context.io);
  if (shown.length === 0 && typeof node.additionalProperties === 'object')
    return { example: walk(node.additionalProperties as JsonSchema, depth + 1, 'example') };
  return Object.fromEntries(
    shown.map(([name, property]) => [
      name,
      context.io === 'output' && nullable(resolved(property, context.components))
        ? null
        : walk(property, depth + 1, name),
    ]),
  );
}

function typedExample(
  node: JsonSchema,
  context: ExampleContext,
  walk: Walk,
  depth: number,
  key: string,
  nextId: () => string,
): unknown {
  const types = Array.isArray(node.type) ? node.type : [node.type];
  const type = types.find((candidate) => candidate !== 'null') ?? types[0];
  if (type === 'string') return stringExample(node, key, nextId);
  if (type === 'integer' || type === 'number') return numberExample(node);
  if (type === 'boolean') return true;
  if (type === 'array') return node.items ? [walk(node.items as JsonSchema, depth + 1, key)] : [];
  if (type === 'object') return objectExample(node, context, walk, depth);
  return null;
}

export function exampleOf(schema: JsonSchema, context: ExampleContext): unknown {
  let counter = 0;
  const nextId = () => {
    counter += 1;
    return fakeUuid(counter);
  };
  const walk: Walk = (node, depth, key) => {
    if (depth > MAX_DEPTH) return null;
    const target = resolved(node, context.components);
    if (target !== node) return walk(target, depth + 1, key);
    if (typeof node.$ref === 'string') return null;
    const fixed = fixedValue(node);
    if (fixed) return fixed.value;
    const variants = variantsOf(node);
    if (variants) {
      const first = variants.find((variant) => variant.type !== 'null') ?? variants[0];
      return first ? walk(first, depth + 1, key) : null;
    }
    if (Array.isArray(node.allOf))
      return Object.assign({}, ...node.allOf.map((part) => walk(part, depth + 1, key)));
    return typedExample(node, context, walk, depth, key, nextId);
  };
  return walk(schema, 0, '');
}
