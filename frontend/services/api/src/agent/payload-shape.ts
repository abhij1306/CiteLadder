import { z } from 'zod';

type SchemaNode = {
  type?: string | string[] | undefined;
  format?: string | undefined;
  const?: unknown;
  enum?: unknown[] | undefined;
  items?: SchemaNode | undefined;
  anyOf?: SchemaNode[] | undefined;
  oneOf?: SchemaNode[] | undefined;
  properties?: Record<string, SchemaNode> | undefined;
  required?: string[] | undefined;
};
const schemaNode: z.ZodType<SchemaNode> = z.lazy(() =>
  z.object({
    type: z.union([z.string(), z.array(z.string())]).optional(),
    format: z.string().optional(),
    const: z.unknown().optional(),
    enum: z.array(z.unknown()).optional(),
    items: schemaNode.optional(),
    anyOf: z.array(schemaNode).optional(),
    oneOf: z.array(schemaNode).optional(),
    properties: z.record(z.string(), schemaNode).optional(),
    required: z.array(z.string()).optional(),
  }),
);

function arrayShape(node: SchemaNode) {
  const item = node.items ? shape(node.items) : 'any';
  return item.includes('|') ? `(${item})[]` : `${item}[]`;
}

function objectShape(node: SchemaNode) {
  const required = new Set(node.required ?? []);
  const fields = Object.entries(node.properties ?? {}).map(
    ([name, child]) => `${name}${required.has(name) ? '' : '?'}: ${shape(child)}`,
  );
  return `{${fields.join(', ')}}`;
}

function scalarShape(type: string | undefined, format: string | undefined) {
  if (type !== 'string' || !format) return type ?? 'any';
  return format;
}

function shape(node: SchemaNode): string {
  const options = node.anyOf ?? node.oneOf;
  if (options) return options.map(shape).join(' | ');
  if (node.const !== undefined) return JSON.stringify(node.const);
  if (node.enum) return node.enum.map((value) => JSON.stringify(value)).join('|');
  const type = Array.isArray(node.type) ? node.type.join('|') : node.type;
  if (type === 'array') return arrayShape(node);
  if (type === 'object') return objectShape(node);
  return scalarShape(type, node.format);
}

export function payloadShape(proposal: z.ZodType) {
  const schema = z.toJSONSchema(proposal, {
    io: 'input',
    unrepresentable: 'any',
  });
  return shape(schemaNode.parse(schema));
}
