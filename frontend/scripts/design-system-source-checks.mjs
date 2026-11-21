import { lineIndex, nameText, parseSource, stringValue, walk } from './source-ast.mjs';

const COLOUR_LITERAL = /#[\da-f]{3,8}\b|(?<![\w-])(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/i;
const CLASS_COLOUR_LITERAL =
  /(?<![\w-])(?:[\w-]+:)*[a-z]+(?:-[a-z]+)*-\[(?:#|(?:rgba?|hsla?|oklch|oklab|lab|lch)\()/i;

const textOf = (node) =>
  node.type === 'TemplateElement' ? (node.value.cooked ?? node.value.raw) : stringValue(node);

export function literalColourViolations(source, label) {
  if (!/^(?:apps|components|lib)\//.test(label) || !label.endsWith('.tsx')) return [];
  if (/\.(?:test|spec)\.tsx$/.test(label)) return [];
  const lineOf = lineIndex(source);
  const violations = [];
  walk(parseSource(source, label), (node) => {
    if (CLASS_COLOUR_LITERAL.test(textOf(node) ?? ''))
      violations.push(
        `${label}:${lineOf(node.start)}: colours come from theme tokens, not a class literal`,
      );
    if (node.type !== 'JSXAttribute' || nameText(node.name) !== 'style') return;
    let found = false;
    walk(node.value, (inner) => {
      if (COLOUR_LITERAL.test(textOf(inner) ?? '')) found = true;
    });
    if (found)
      violations.push(
        `${label}:${lineOf(node.start)}: colours come from theme tokens, not an inline style`,
      );
  });
  return violations;
}

export function directRadixImportViolations(source, label) {
  return !label.startsWith('components/ui/') && /from\s+['"]@radix-ui\//.test(source)
    ? [`${label}: feature code must use components/ui instead of importing Radix`]
    : [];
}

export function appSourceViolations(appCss, files) {
  const listed = [...appCss.matchAll(/@source\s+'\.\.\/\.\.\/\.\.\/([^']+)'/g)].map(([, path]) =>
    path.replace(/\/$/, ''),
  );
  const covered = (label) => listed.some((path) => label === path || label.startsWith(`${path}/`));
  const missing = new Map();
  for (const { label, source } of files) {
    if (!covered(label)) continue;
    for (const [, name] of source.matchAll(/(?:from |import\()'@\/components\/([\w-]+)\//g)) {
      const directory = `components/${name}`;
      if (!covered(directory) && !missing.has(directory)) missing.set(directory, label);
    }
  }
  return [...missing].map(
    ([directory, label]) =>
      `apps/app/src/app.css: ${directory} (imported by ${label}) is missing from @source, so its classes are never generated`,
  );
}
