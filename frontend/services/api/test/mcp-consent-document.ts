import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { expect } from 'vitest';

type Node = DefaultTreeAdapterMap['node'];
type Element = { name: string; attrs: Record<string, string> };

function elementsAndText(source: string) {
  const elements: Element[] = [];
  let text = '';
  const walk = (node: Node) => {
    if (node.nodeName === 'style') return;
    if (node.nodeName === '#text' && 'value' in node) text += node.value;
    if ('attrs' in node)
      elements.push({
        name: node.nodeName,
        attrs: Object.fromEntries(node.attrs.map((attr) => [attr.name, attr.value])),
      });
    if ('childNodes' in node) for (const child of node.childNodes) walk(child);
  };
  walk(parse(source));
  return { elements, text: text.replace(/\s+/gu, ' ') };
}

export function consentDocument(source: string) {
  const { elements, text } = elementsAndText(source);
  const all = (name: string) => elements.filter((e) => e.name === name).map((e) => e.attrs);
  const inputs = all('input');
  const refresh = all('meta').find((meta) => meta['http-equiv'] === 'refresh')?.content ?? '';
  return {
    workspaces: inputs.filter(
      (input) =>
        input.type === 'checkbox' && !['accept_terms', 'allow_changes'].includes(input.name ?? ''),
    ),
    changes: inputs.find((input) => input.name === 'allow_changes'),
    terms: inputs.find((input) => input.name === 'accept_terms'),
    termsRevision: inputs.find((input) => input.name === 'terms_revision')?.value,
    links: all('a').flatMap((a) => (a.href ? [a.href] : [])),
    refresh: /^0; url=(.+)$/u.exec(refresh)?.[1],
    text,
  };
}

/**
 * Where a decision hands the browser back: a page, not a redirect, because
 * `form-action` governs every redirect after the post. Its link repeats the target.
 */
export async function callbackOf(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get('location')).toBeNull();
  expect(response.headers.get('content-security-policy')).toMatch(/; form-action 'none'$/u);
  expect(response.headers.get('x-frame-options')).toBe('DENY');
  const page = consentDocument(await response.text());
  expect(page.links).toEqual([page.refresh]);
  return new URL(page.refresh!);
}
