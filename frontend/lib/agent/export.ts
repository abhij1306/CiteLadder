import { saveBlob } from '@/lib/download';
import { markdownHtml, markdownPlainText } from '@/lib/markdown/html';

/** A filesystem-safe name derived from the output title. */
function exportFilename(title: string, extension: 'md' | 'html'): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return `${slug || 'agent-output'}.${extension}`;
}

/** The revision exactly as shown: its title as the heading, then its body. */
export function outputMarkdown(title: string, body: string): string {
  return `# ${title}\n\n${body.trimEnd()}\n`;
}

export function downloadOutputMarkdown(title: string, body: string): void {
  saveBlob(
    new Blob([outputMarkdown(title, body)], { type: 'text/markdown;charset=utf-8' }),
    exportFilename(title, 'md'),
  );
}

/**
 * A page document's exports (phase 2, PR 3). The body is the page's content
 * as edited, its own headings included; the title is the page's title tag,
 * so it names the file and the HTML document but is not repeated as a heading.
 */
export type PageExportFormat = 'markdown' | 'html' | 'text';

const ESCAPED: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

const escapeHtml = (text: string) => text.replaceAll(/[&<>"]/g, (char) => ESCAPED[char] ?? char);

/** The page body in one export format. */
export function pageExport(body: string, format: PageExportFormat): string {
  if (format === 'html') return markdownHtml(body);
  if (format === 'text') return `${markdownPlainText(body)}\n`;
  return `${body.trimEnd()}\n`;
}

/** A standalone HTML file: the title in the head, the page's HTML as the body. */
function pageHtmlDocument(title: string, body: string): string {
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    '</head>',
    '<body>',
    markdownHtml(body),
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export function downloadPage(title: string, body: string, extension: 'md' | 'html'): void {
  const blob =
    extension === 'html'
      ? new Blob([pageHtmlDocument(title, body)], { type: 'text/html;charset=utf-8' })
      : new Blob([pageExport(body, 'markdown')], { type: 'text/markdown;charset=utf-8' });
  saveBlob(blob, exportFilename(title, extension));
}
