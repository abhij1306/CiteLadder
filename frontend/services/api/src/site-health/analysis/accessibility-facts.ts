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

function hasAssociatedLabel(control: HtmlElement, explicitIds: Set<string>) {
  if (explicitIds.has(attribute(control, 'id').trim())) return true;
  const label = [...ancestors(control)].find((item) => item.tagName === 'label');
  return label ? Boolean(accessibleText(label)) : false;
}

function hasName(control: HtmlElement, explicitIds: Set<string>, labelled: Map<string, boolean>) {
  return (
    Boolean(attribute(control, 'aria-label').trim()) ||
    attribute(control, 'aria-labelledby')
      .split(/\s+/u)
      .some((reference) => labelled.get(reference) === true) ||
    hasNativeName(control) ||
    hasAssociatedLabel(control, explicitIds) ||
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
  const explicitIds = new Set(
    all
      .filter(
        (node) => node.tagName === 'label' && hasAttribute(node, 'for') && accessibleText(node),
      )
      .map((node) => attribute(node, 'for').trim()),
  );
  const labelled = new Map<string, boolean>();
  for (const node of all) {
    const id = attribute(node, 'id').trim();
    if (id && referenced.has(id)) labelled.set(id, Boolean(accessibleText(node, true)));
  }
  const missing = controls.flatMap((control, index) =>
    hasName(control, explicitIds, labelled)
      ? []
      : [
          {
            tag: control.tagName,
            type: control.tagName === 'input' ? inputType(control) || 'text' : control.tagName,
            id: identifier(control, 'id'),
            name: identifier(control, 'name'),
            ordinal: index + 1,
          },
        ],
  );
  return { count: controls.length, missing };
}

export function accessibilityFacts(root: HtmlNode, maxHeadings: number) {
  const { count, missing } = controlFacts(root);
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
    heading_levels: levels.slice(0, maxHeadings),
    heading_level_skips: skips,
    document_language: html ? attribute(html, 'lang').trim().slice(0, 32) : '',
  };
}
