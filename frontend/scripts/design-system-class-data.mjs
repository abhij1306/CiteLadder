import {
  lineIndex,
  nameText,
  parseSource,
  stringFragments,
  stringValue,
  unwrap,
  walk,
} from './source-ast.mjs';

export function escapeRegExp(value) {
  return value.replace(/[.*+?^$(){}|[\]\\]/g, String.raw`\$&`);
}

/** Alternation over literal values, escaped for use inside a RegExp. */
export const oneOf = (values) => `(?:${values.map(escapeRegExp).join('|')})`;

export function staticBindings(program) {
  const bindings = new Map();
  walk(program, (node) => {
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.init) {
      bindings.set(node.id.name, node.init);
    }
  });
  return bindings;
}

function identifierClassFragments(node, bindings, seen) {
  if (seen.has(node.name)) return [];
  const initializer = bindings.get(node.name);
  if (!initializer) return [];
  return classFragments(initializer, bindings, new Set([...seen, node.name]));
}

function memberClassFragments(node, bindings, seen) {
  const target = unwrap(
    node.object?.type === 'Identifier' ? bindings.get(node.object.name) : node.object,
  );
  if (target?.type === 'ObjectExpression') {
    return target.properties.flatMap((property) =>
      property.type === 'Property' ? classFragments(property.value, bindings, seen) : [],
    );
  }
  return classFragments(target, bindings, seen);
}

const childFragments = (children, bindings, seen) =>
  children.flatMap((child) => classFragments(child, bindings, seen));

/** Class fragments per expression type, once literals and wrappers are peeled off. */
const CLASS_FRAGMENT_READERS = {
  Identifier: identifierClassFragments,
  MemberExpression: memberClassFragments,
  CallExpression: (node, bindings, seen) => childFragments(node.arguments, bindings, seen),
  ConditionalExpression: (node, bindings, seen) =>
    childFragments([node.consequent, node.alternate], bindings, seen),
  BinaryExpression: (node, bindings, seen) =>
    childFragments([node.left, node.right], bindings, seen),
  LogicalExpression: (node, bindings, seen) =>
    childFragments([node.left, node.right], bindings, seen),
  ArrayExpression: (node, bindings, seen) => childFragments(node.elements, bindings, seen),
  // Conditional class maps key the class off a flag, so the key is the class.
  ObjectExpression: (node, bindings, seen) =>
    childFragments(
      node.properties.filter((property) => property.type === 'Property').map(({ key }) => key),
      bindings,
      seen,
    ),
  JSXExpressionContainer: (node, bindings, seen) => classFragments(node.expression, bindings, seen),
};

export function classFragments(node, bindings, seen = new Set()) {
  if (!node) return [];
  const literal = stringValue(node);
  if (literal !== null) return [literal];
  if (node.type === 'TemplateLiteral') {
    // Both halves matter: the static chunks carry classes directly, and the
    // interpolations can resolve to more through the binding table.
    return [
      ...node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw ?? ''),
      ...childFragments(node.expressions, bindings, seen),
    ];
  }
  const unwrapped = unwrap(node);
  if (unwrapped !== node) return classFragments(unwrapped, bindings, seen);
  const reader = Object.hasOwn(CLASS_FRAGMENT_READERS, node.type)
    ? CLASS_FRAGMENT_READERS[node.type]
    : null;
  return reader ? reader(node, bindings, seen) : [];
}

/** Every prop through which a call site can hand Tailwind classes to a component. */
const CLASS_ATTRIBUTES = new Set([
  'className',
  'rootClassName',
  'contentClassName',
  'bodyClassName',
  'panelClassName',
  'itemClassName',
  'triggerClassName',
]);

/** Every JSX element's class attributes as `{ tag, classes, line }`. */
export function jsxClassData(source, label) {
  const program = parseSource(source, label);
  const lineOf = lineIndex(source);
  const bindings = staticBindings(program);
  const entries = [];
  walk(program, (node) => {
    if (node.type !== 'JSXOpeningElement') return;
    // `className` is not the only way a call site hands classes to a
    // component. `rootClassName="grid gap-6"` slipped past every spacing and
    // type rule for exactly as long as this only looked at one attribute.
    const classAttributes = node.attributes.filter(
      (property) =>
        property.type === 'JSXAttribute' && CLASS_ATTRIBUTES.has(nameText(property.name)),
    );
    for (const classAttribute of classAttributes) {
      entries.push({
        tag: nameText(node.name),
        classes: classAttribute.value
          ? classFragments(classAttribute.value, bindings).join(' ')
          : '',
        line: lineOf(node.start),
      });
    }
  });
  return entries;
}

/** Every class-like token in a module's string and template text. */
export function classTokens(program, lineOf) {
  return stringFragments(program).flatMap(({ text, start }) => {
    const line = lineOf(start);
    return text
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => ({ token, line }));
  });
}
