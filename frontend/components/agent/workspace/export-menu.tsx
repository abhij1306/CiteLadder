import { ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { useToast } from '@/components/ui/toast';
import { downloadPage, pageExport, type PageExportFormat } from '@/lib/agent/export';

const COPIED: Readonly<Record<PageExportFormat, string>> = {
  markdown: 'Copied as Markdown',
  html: 'Copied as HTML',
  text: 'Copied as plain text',
};

/** HTML goes to the clipboard as HTML, with plain text beside it for apps that paste text. */
async function copyPage(body: string, format: PageExportFormat) {
  const value = pageExport(body, format);
  if (format !== 'html' || typeof ClipboardItem === 'undefined') {
    await navigator.clipboard.writeText(value);
    return;
  }
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob([value], { type: 'text/html' }),
      'text/plain': new Blob([pageExport(body, 'text')], { type: 'text/plain' }),
    }),
  ]);
}

/**
 * Export ▾: the page on screen copied as Markdown, HTML or plain text, or
 * downloaded as `.md` or `.html`. The title tag names the file.
 */
export function ExportMenu({ title, body }: Readonly<{ title: string; body: string }>) {
  const { notify } = useToast();
  const copy = (format: PageExportFormat) =>
    void copyPage(body, format).then(
      () => notify(COPIED[format], undefined, { tone: 'positive' }),
      () => notify('Copy failed. Try again.', undefined, { tone: 'negative' }),
    );
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="secondary">
          Export
          <Icon icon={ChevronDown} />
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem onSelect={() => copy('markdown')}>Copy as Markdown</MenuItem>
        <MenuItem onSelect={() => copy('html')}>Copy as HTML</MenuItem>
        <MenuItem onSelect={() => copy('text')}>Copy as plain text</MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => downloadPage(title, body, 'md')}>Download .md</MenuItem>
        <MenuItem onSelect={() => downloadPage(title, body, 'html')}>Download .html</MenuItem>
      </MenuContent>
    </Menu>
  );
}
