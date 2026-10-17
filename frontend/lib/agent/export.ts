import { saveBlob } from '@/lib/download';

/** A filesystem-safe name derived from the output title. */
function exportFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return `${slug || 'agent-output'}.md`;
}

/** The revision exactly as shown: its title as the heading, then its body. */
export function outputMarkdown(title: string, body: string): string {
  return `# ${title}\n\n${body.trimEnd()}\n`;
}

export function downloadOutputMarkdown(title: string, body: string): void {
  saveBlob(
    new Blob([outputMarkdown(title, body)], { type: 'text/markdown;charset=utf-8' }),
    exportFilename(title),
  );
}
