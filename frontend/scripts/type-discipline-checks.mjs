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

const DISCRIMINANTS = new Set(['kind', 'type', 'status', 'state', 'phase', 'mode', 'event_type']);

const discriminantName = (node) =>
  node?.type === 'Identifier' ? node.name : (propertyName(node) ?? '');

const isNever = (annotation) => annotation?.type === 'TSNeverKeyword';

function provesNever(expression) {
  if (expression?.type === 'TSSatisfiesExpression') return isNever(expression.typeAnnotation);
  return (
    expression?.type === 'CallExpression' &&
    expression.callee.type === 'Identifier' &&
    expression.callee.name === 'assertNever'
  );
}

function provesStatement(statement) {
  switch (statement.type) {
    case 'BlockStatement':
      return statement.body.some(provesStatement);
    case 'VariableDeclaration':
      return statement.declarations.some(
        (declarator) => declarator.init && isNever(declarator.id.typeAnnotation?.typeAnnotation),
      );
    case 'ReturnStatement':
    case 'ThrowStatement':
      return provesNever(statement.argument);
    case 'ExpressionStatement':
      return provesNever(statement.expression);
    default:
      return false;
  }
}

const provesExhaustive = (clause) => clause.consequent.some(provesStatement);

function openSwitch(node) {
  if (node.type !== 'SwitchStatement' || !DISCRIMINANTS.has(discriminantName(node.discriminant)))
    return false;
  const fallback = node.cases.find((clause) => clause.test === null);
  return !fallback || !provesExhaustive(fallback);
}

export const isApiSource = (label) => label.startsWith('services/api/src/');

export function nonNullCount(source, label) {
  let count = 0;
  walk(parseSource(source, label), (node) => {
    if (node.type === 'TSNonNullExpression') count += 1;
  });
  return count;
}

export function nonNullRatchetFailures(counts, baseline) {
  return Object.entries(counts)
    .filter(([file, count]) => count > (baseline[file] ?? 0))
    .map(
      ([file, count]) =>
        `${file}: ${count} non-null assertions, baseline ${baseline[file] ?? 0}; narrow the value instead of asserting it`,
    );
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
    if (openSwitch(node))
      add(
        node,
        'exhaustive-switch',
        'switch on a discriminant without a never arm; end it with a default that assigns to never',
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
