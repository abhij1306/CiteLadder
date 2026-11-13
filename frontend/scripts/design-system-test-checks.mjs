import { lineIndex, nameText, parseSource, stringValue, walk } from './source-ast.mjs';

const SEMANTIC_TEST_CLASSES = new Set([
  'focus-ring',
  'sr-only',
  'tabular-nums',
  'value-placeholder',
]);
/** Utility stems that are presentation whenever a `-` follows them. */
const RAW_STYLE_STEMS = new Set([
  'bg',
  'text',
  'border',
  'rounded',
  'shadow',
  'p',
  'px',
  'py',
  'ps',
  'pe',
  'pt',
  'pb',
  'm',
  'mx',
  'my',
  'ms',
  'me',
  'mt',
  'mb',
  'gap',
  'space',
  'w',
  'h',
  'min',
  'max',
  'z',
  'table',
  'overflow',
  'whitespace',
  'translate',
  'opacity',
  'size',
  'shrink',
  'grow',
  'items',
  'justify',
  'content',
  'place',
  'font',
  'tracking',
  'leading',
  'break',
  'ring',
  'divide',
  'align',
]);
/** Utilities that are presentation on their own. */
const RAW_STYLE_BARE_UTILITIES = new Set(['border', 'rounded', 'shadow']);
/** Utility prefixes that are presentation whatever follows them. */
const RAW_STYLE_PREFIXES = [
  'truncate',
  'sticky',
  'hidden',
  'grid',
  'flex',
  'inline-flex',
  'block',
  'uppercase',
  'lowercase',
];
const ARBITRARY_VALUE_PREFIX = /^\[[^\]]+\]/;

/** Whether a class with its variants stripped starts with a presentation utility. */
function isRawStyleUtility(utility) {
  const dash = utility.indexOf('-');
  return (
    ARBITRARY_VALUE_PREFIX.test(utility) ||
    RAW_STYLE_BARE_UTILITIES.has(utility) ||
    (dash > 0 && RAW_STYLE_STEMS.has(utility.slice(0, dash))) ||
    RAW_STYLE_PREFIXES.some((prefix) => utility.startsWith(prefix))
  );
}

/**
 * A raw style token is an optional `-`, any non-empty `variant:` prefixes, then
 * a presentation utility. Every split point between those prefixes is tried.
 */
function isRawStyleAssertionToken(token) {
  if (isRawStyleUtility(token.startsWith('-') ? token.slice(1) : token)) return true;
  let segmentStart = 0;
  for (
    let colon = token.indexOf(':');
    colon > segmentStart;
    colon = token.indexOf(':', segmentStart)
  ) {
    if (isRawStyleUtility(token.slice(colon + 1))) return true;
    segmentStart = colon + 1;
  }
  return false;
}

function testExpression(node) {
  let current = node;
  while (
    current &&
    (current.type === 'ChainExpression' ||
      current.type === 'ParenthesizedExpression' ||
      current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TSNonNullExpression')
  ) {
    current = current.expression;
  }
  return current;
}

function memberPropertyName(node) {
  const expression = testExpression(node);
  if (expression?.type !== 'MemberExpression') return '';
  return expression.computed
    ? (stringValue(expression.property) ?? '')
    : nameText(expression.property);
}

function callName(node) {
  const expression = testExpression(node);
  return expression?.type === 'Identifier' ? expression.name : '';
}

function styleAssertion(node) {
  if (node.type !== 'CallExpression') return null;
  const callee = testExpression(node.callee);
  if (callee?.type !== 'MemberExpression') return null;

  let receiver = testExpression(callee.object);
  if (memberPropertyName(receiver) === 'not') {
    receiver = testExpression(receiver.object);
  }
  if (receiver?.type !== 'CallExpression' || callName(receiver.callee) !== 'expect') return null;

  const matcher = memberPropertyName(callee);
  const target = testExpression(receiver.arguments[0]);
  // `expect(el.classList.contains('bg-panel')).toBe(true)` asserts the same
  // visual recipe as `toHaveClass`, but the class sits in the `contains`
  // argument rather than the matcher's, so the tokens have to be read there.
  if (
    target?.type === 'CallExpression' &&
    memberPropertyName(target.callee) === 'contains' &&
    memberPropertyName(testExpression(target.callee)?.object) === 'classList'
  ) {
    return { matcher, arguments: target.arguments };
  }
  if (matcher !== 'toHaveClass' && memberPropertyName(target) !== 'className') return null;
  return { matcher, arguments: node.arguments };
}

function staticAssertionText(node) {
  const expression = testExpression(node);
  if (stringValue(expression) !== null) return [stringValue(expression)];
  // Only an expression-free template is static text. One with interpolations
  // hides the class behind a runtime value, so it has to read as dynamic —
  // returning its quasis would let `` `${cls}` `` pass as an empty assertion.
  if (expression?.type === 'TemplateLiteral' && expression.expressions.length === 0) {
    return expression.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw ?? '');
  }
  return [];
}

function isSemanticTestClass(token) {
  return SEMANTIC_TEST_CLASSES.has(token) || /^website-|(?:-hook)$/.test(token);
}

function rawStyleAssertionTokens(text) {
  return text
    .split(/\s+/)
    .filter((token) => token && !isSemanticTestClass(token) && isRawStyleAssertionToken(token));
}

/** Tests assert contracts and consistency, never a frozen presentation recipe. */
export function styleAssertionViolations(source, label) {
  if (!/(?:\.test|\.spec)\./.test(label)) return [];
  const program = parseSource(source, label);
  const lineOf = lineIndex(source);
  const violations = [];

  walk(program, (node) => {
    const assertion = styleAssertion(node);
    if (!assertion) return;
    const staticText = assertion.arguments.flatMap(staticAssertionText);
    const hasDynamicArgument = assertion.arguments.some(
      (argument) => staticAssertionText(argument).length === 0,
    );
    const rawTokens = staticText.flatMap(rawStyleAssertionTokens);
    if (hasDynamicArgument || rawTokens.length > 0) {
      const detail = rawTokens.length > 0 ? ` (${rawTokens.join(', ')})` : '';
      violations.push(
        `${label}:${lineOf(node.start)}: visual class assertions${detail} must not freeze presentation; assert contracts or semantic roles`,
      );
    }
  });

  return violations;
}
