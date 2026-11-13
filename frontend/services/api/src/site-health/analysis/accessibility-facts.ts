/** Static accessible-name, heading-order and document-language observations. */
import {
  ancestors,
  attribute,
  elements,
  hasAttribute,
  parentElement,
  textNodes,
  type HtmlElement,
  type HtmlNode,
} from '../../web-evidence/html.ts';
import { limits, squash } from './policy.ts';
import { referenceSnippet } from './reference-snippet.ts';

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const CONTROLS = new Set(['input', 'select', 'textarea', 'button']);
const inputType = (node: HtmlElement) => attribute(node, 'type').trim().toLowerCase();

/** Whether a node is outside the accessibility tree: template, hidden, inert or aria-hidden. */
function excluded(node: HtmlElement, templateOnly = false) {
  for (const item of [node, ...ancestors(node)]) {
    if (item.tagName === 'template') return true;
    if (templateOnly) continue;
    if (
      hasAttribute(item, 'hidden') ||
      hasAttribute(item, 'inert') ||
      attribute(item, 'aria-hidden').trim().toLowerCase() === 'true'
    )
      return true;
  }
  return false;
}

/** Text alternatives a naming subtree contributes; a directly referenced label may be hidden. */
function accessibleText(node: HtmlElement, directlyReferenced = false) {
  const parts: string[] = [];
  for (const text of textNodes(node)) {
    const parent = parentElement(text);
    if (!parent || !excluded(parent, directlyReferenced)) parts.push(text.value);
  }
  for (const image of elements(node, 'img'))
    if (
      hasAttribute(image, 'alt') &&
      !excluded(image, true) &&
      (directlyReferenced || !excluded(image))
    )
      parts.push(attribute(image, 'alt'));
  return squash(parts.join(' '));
}

function hasNativeName(control: HtmlElement) {
  if (control.tagName === 'button' && accessibleText(control)) return true;
  if (control.tagName !== 'input') return false;
  const type = inputType(control);
  if (['button', 'submit', 'reset'].includes(type))
    return Boolean(attribute(control, 'value').trim()) || type === 'submit' || type === 'reset';
  return type === 'image' && Boolean(attribute(control, 'alt').trim());
}

const LABELABLE = new Set(['button', 'input', 'meter', 'output', 'progress', 'select', 'textarea']);
const labelable = (node: HtmlElement) =>
  LABELABLE.has(node.tagName) && !(node.tagName === 'input' && inputType(node) === 'hidden');

/**
 * HTML's labeled control: a label with `for` names only the first element with
 * that id (`explicit`), never the one it wraps, and an empty `for` names
 * nothing; a label without `for` names its first labelable descendant.
 */
function hasAssociatedLabel(control: HtmlElement, explicit: Set<HtmlElement>) {
  if (explicit.has(control)) return true;
  const label = [...ancestors(control)].find((item) => item.tagName === 'label');
  if (!label || hasAttribute(label, 'for')) return false;
  return [...elements(label)].find(labelable) === control && Boolean(accessibleText(label));
}

function hasName(control: HtmlElement, explicit: Set<HtmlElement>, labelled: Map<string, boolean>) {
  return (
    Boolean(attribute(control, 'aria-label').trim()) ||
    attribute(control, 'aria-labelledby')
      .split(/\s+/u)
      .some((reference) => labelled.get(reference) === true) ||
    hasNativeName(control) ||
    hasAssociatedLabel(control, explicit) ||
    Boolean(attribute(control, 'title').trim())
  );
}

const identifier = (control: HtmlElement, name: string) =>
  squash(attribute(control, name)).slice(0, limits.accessibility_identifier_chars);

function controlFacts(root: HtmlNode) {
  const all = [...elements(root)];
  const controls = all.filter(
    (node) =>
      CONTROLS.has(node.tagName) &&
      !(node.tagName === 'input' && inputType(node) === 'hidden') &&
      !excluded(node),
  );
  const referenced = new Set(
    controls.flatMap((control) => attribute(control, 'aria-labelledby').split(/\s+/u)),
  );
  // Ids should be unique; when one repeats, a label names only its first element.
  const firstWithId = new Map<string, HtmlElement>();
  for (const node of all) {
    const id = attribute(node, 'id').trim();
    if (id && !firstWithId.has(id)) firstWithId.set(id, node);
  }
  const explicit = new Set(
    all.flatMap((node) => {
      if (node.tagName !== 'label' || !accessibleText(node)) return [];
      const target = firstWithId.get(attribute(node, 'for').trim());
      return target && hasAttribute(node, 'for') ? [target] : [];
    }),
  );
  const labelled = new Map<string, boolean>();
  for (const node of all) {
    const id = attribute(node, 'id').trim();
    if (id && referenced.has(id)) labelled.set(id, Boolean(accessibleText(node, true)));
  }
  const unnamed = controls.flatMap((control, index) =>
    hasName(control, explicit, labelled) ? [] : [{ control, ordinal: index + 1 }],
  );
  const missing = unnamed.map(({ control, ordinal }) => ({
    tag: control.tagName,
    type: control.tagName === 'input' ? inputType(control) || 'text' : control.tagName,
    id: identifier(control, 'id'),
    name: identifier(control, 'name'),
    ordinal,
  }));
  // One reference snippet per page, of its first unnamed control: the issue
  // catalog keeps one per issue family from these (`issue-catalog.ts`).
  const first = unnamed[0];
  return {
    count: controls.length,
    missing,
    snippet: first ? referenceSnippet(first.control) : null,
  };
}

export function accessibilityFacts(root: HtmlNode, maxHeadings: number) {
  const { count, missing, snippet } = controlFacts(root);
  const levels = [...elements(root)]
    .filter((node) => HEADINGS.has(node.tagName) && !excluded(node))
    .map((node) => Number(node.tagName[1]));
  const skips = levels.filter((level, index) => index > 0 && level > levels[index - 1]! + 1).length;
  const html = elements(root, 'html').next().value;
  return {
    control_count: count,
    controls_missing_accessible_name: missing.length,
    controls_missing_accessible_name_descriptors: missing.slice(
      0,
      limits.accessibility_control_descriptors,
    ),
    controls_missing_accessible_name_snippet: snippet,
    heading_levels: levels.slice(0, maxHeadings),
    heading_level_skips: skips,
    document_language: html ? attribute(html, 'lang').trim().slice(0, 32) : '',
  };
}
