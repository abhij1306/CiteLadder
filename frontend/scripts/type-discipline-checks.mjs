import { lineIndex, parseSource, walk } from './source-ast.mjs';

const OBJECT_KEY_READERS = new Set(['keys', 'entries']);
const RADIX_VALUE_OWNERS = new Set([
  'components/ui/radio-group.tsx',
  'components/ui/select.tsx',
  'components/ui/tabs.tsx',
]);

const propertyName = (node) =>
  node?.type === 'MemberExpression' && !node.computed ? node.property?.name : undefined;

const isNumber = (node) =>
  (node?.type === 'Literal' && typeof node.value === 'number') ||
  (node?.type === 'UnaryExpression' && node.operator === '-' && isNumber(node.argument));

const isSplit = (node) => node?.type === 'CallExpression' && propertyName(node.callee) === 'split';

function keysCast(node) {
  if (node.type !== 'TSAsExpression') return false;
  const call = node.expression;
  return (
    call?.type === 'CallExpression' &&
    OBJECT_KEY_READERS.has(propertyName(call.callee)) &&
    call.callee.object.type === 'Identifier' &&
    call.callee.object.name === 'Object'
  );
}

function indexNonNull(node) {
  if (node.type !== 'TSNonNullExpression') return false;
  const target = node.expression;
  if (target?.type === 'MemberExpression' && target.computed)
    return isNumber(target.property) && !isSplit(target.object);
  if (target?.type === 'CallExpression' && propertyName(target.callee) === 'at')
    return isNumber(target.arguments?.[0]) && !isSplit(target.callee.object);
  return false;
}

const isValueChangeHandler = (node) =>
  node.type === 'JSXAttribute' &&
  node.name?.type === 'JSXIdentifier' &&
  node.name.name === 'onValueChange';

export function typeDisciplineFindings(source, label) {
  const program = parseSource(source, label);
  const lineOf = lineIndex(source);
  const findings = [];
  const add = (node, rule, message) =>
    findings.push({ file: label, rule, line: lineOf(node.start), message });
  const ownsRadixCast = RADIX_VALUE_OWNERS.has(label);
  walk(program, (node) => {
    if (keysCast(node))
      add(
        node,
        'keys-cast',
        'Object.keys/entries cast to a key type; derive the keys from their owner',
      );
    if (indexNonNull(node))
      add(
        node,
        'index-non-null',
        'non-null assertion on an indexed element; make the list non-empty by construction',
      );
    if (!ownsRadixCast && isValueChangeHandler(node))
      walk(node.value, (inner) => {
        if (inner.type === 'TSAsExpression')
          add(
            inner,
            'value-change-cast',
            'cast in onValueChange; type the generic control by its options',
          );
      });
  });
  return findings;
}
