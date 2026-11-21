import { parseSync, visitorKeys } from 'oxc-parser';

let lastParse = { source: null, label: null, program: null };

export function parseSource(source, label) {
  if (lastParse.source === source && lastParse.label === label) return lastParse.program;
  const program = parseProgram(source, label);
  lastParse = { source, label, program };
  return program;
}

function parseProgram(source, label) {
  const { program, errors } = parseSync(label, source);
  if (!errors.length) return program;
  if (errors.some((error) => /Adjacent JSX elements/.test(error.message))) {
    const wrapped = parseSync(label, `<>${source}</>`);
    if (!wrapped.errors.length) return shiftOffsets(wrapped.program, -'<>'.length);
  }
  throw new Error(`${label}: could not parse — ${errors[0].message}`);
}

function shiftOffsets(node, delta) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    for (const item of node) shiftOffsets(item, delta);
    return node;
  }
  if (typeof node.start === 'number') node.start += delta;
  if (typeof node.end === 'number') node.end += delta;
  for (const key of Object.keys(node)) {
    if (key !== 'start' && key !== 'end') shiftOffsets(node[key], delta);
  }
  return node;
}

export function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (typeof node.type !== 'string') return;
  visit(node);
  for (const key of visitorKeys[node.type] ?? []) walk(node[key], visit);
}

export function lineIndex(source) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1);
  }
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

export function stringValue(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  return null;
}

export function nameText(node) {
  if (!node) return '';
  switch (node.type) {
    case 'JSXIdentifier':
    case 'Identifier':
      return node.name;
    case 'JSXNamespacedName':
      return `${nameText(node.namespace)}:${nameText(node.name)}`;
    case 'JSXMemberExpression':
      return `${nameText(node.object)}.${nameText(node.property)}`;
    default:
      return '';
  }
}
