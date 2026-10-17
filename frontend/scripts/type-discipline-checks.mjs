import { lineIndex, parseSource, walk } from './source-ast.mjs';

/**
 * Type-discipline findings: the casts and assertions TypeScript reviews kept
 * finding, each of which hides a fact the compiler could have checked.
 *
 *   - `keys-cast`: `Object.keys(x) as K[]` claims the object holds no other
 *     keys. Derive the list from the data that owns the order instead.
 *   - `index-non-null`: `list[0]!` / `list.at(-1)!` claims a list is non-empty.
 *     Make it non-empty by construction (`[T, ...T[]]`), destructure, or read
 *     the value once and check it. `split(...)[0]` is exempt: a split always
 *     yields at least one part.
 *   - `value-change-cast`: a cast inside an `onValueChange` handler. The shared
 *     Select, RadioGroup and Tabs are generic over their option values, so the
 *     handler receives the option type; those three controls own the one cast
 *     from Radix's string.
 *
 * check-design-system.mjs runs these in its file walk and ratchets them per
 * file and rule against type-discipline-baseline.json, so recorded debt burns
 * down and a new occurrence fails.
 */

const OBJECT_KEY_READERS = new Set(['keys', 'entries']);
/** The generic controls that turn Radix's string into their option type. */
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
    // A named property implies a member callee, so `object` is then defined.
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

/** Every type-discipline finding in one module, line-addressed. */
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
