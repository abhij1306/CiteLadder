import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { safeUrlTransform } from './safe-url';

function rendered(markdown: string): HTMLElement {
  const container = document.implementation.createHTMLDocument('').createElement('div');
  const root = createRoot(container);
  flushSync(() =>
    root.render(
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeUrlTransform}>
        {markdown}
      </ReactMarkdown>,
    ),
  );
  // The rendered nodes stay in the container once the root lets go of them.
  const snapshot = container.cloneNode(true);
  root.unmount();
  return snapshot instanceof HTMLElement ? snapshot : container;
}

export function markdownHtml(markdown: string): string {
  return rendered(markdown).innerHTML;
}

const LISTS = new Set(['UL', 'OL']);

function listText(list: Element, depth: number): string {
  const ordered = list.tagName === 'OL';
  return [...list.children]
    .map((item, index) => {
      const marker = ordered ? `${index + 1}. ` : '- ';
      const own = [...item.childNodes]
        .filter((node) => !(node instanceof Element && LISTS.has(node.tagName)))
        .map((node) => node.textContent ?? '')
        .join('')
        .trim();
      const nested = [...item.children]
        .filter((child) => LISTS.has(child.tagName))
        .map((child) => listText(child, depth + 1));
      return ['  '.repeat(depth) + marker + own, ...nested].join('\n');
    })
    .join('\n');
}

function tableText(table: Element): string {
  return [...table.querySelectorAll('tr')]
    .map((row) => [...row.children].map((cell) => (cell.textContent ?? '').trim()).join('\t'))
    .join('\n');
}

function blockText(block: Element): string {
  if (LISTS.has(block.tagName)) return listText(block, 0);
  if (block.tagName === 'TABLE') return tableText(block);
  if (block.tagName === 'BLOCKQUOTE') return blocksText(block);
  if (block.tagName === 'PRE') return (block.textContent ?? '').replace(/\n$/, '');
  return (block.textContent ?? '').trim();
}

function blocksText(parent: Element): string {
  return [...parent.children]
    .map(blockText)
    .filter((text) => text.length > 0)
    .join('\n\n');
}

export function markdownPlainText(markdown: string): string {
  return blocksText(rendered(markdown));
}
