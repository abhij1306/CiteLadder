import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Inline } from '@/components/ui/layout';
import { useToast } from '@/components/ui/toast';
import type {
  ExportFilters,
  ExportFormat,
  ExportView,
  IssueExportParams,
} from '@/lib/api/site-health';
import { Download } from '@/lib/icons';
import { downloadCrawlExport } from '@/lib/site-health/download';

const FORMATS: readonly { format: ExportFormat; label: string }[] = [
  { format: 'csv', label: 'Export CSV' },
  { format: 'md', label: 'Export Markdown' },
];

function useCrawlExport({
  workspaceId,
  crawlId,
  view,
  filters,
}: Readonly<{ workspaceId: string; crawlId: string; view: ExportView; filters: ExportFilters }>) {
  const { notify } = useToast();
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const run = async (format: ExportFormat) => {
    setExporting(format);
    try {
      await downloadCrawlExport({ crawlId, format, view, filters }, { workspaceId });
    } catch {
      notify('Export failed', undefined, { tone: 'negative' });
    } finally {
      setExporting(null);
    }
  };
  return { exporting, run };
}

export function IssuesExport({
  workspaceId,
  crawlId,
  filters,
}: Readonly<{ workspaceId: string; crawlId: string; filters: IssueExportParams }>) {
  const { exporting, run } = useCrawlExport({ workspaceId, crawlId, view: 'issues', filters });
  return (
    <Inline>
      {FORMATS.map(({ format, label }) => (
        <Button
          key={format}
          variant="secondary"
          onClick={() => void run(format)}
          pending={exporting === format}
          disabled={exporting !== null}
        >
          <Icon icon={Download} />
          {label}
        </Button>
      ))}
    </Inline>
  );
}

export function IssuePagesExport({
  workspaceId,
  crawlId,
  groupId,
}: Readonly<{ workspaceId: string; crawlId: string; groupId: string }>) {
  const { exporting, run } = useCrawlExport({
    workspaceId,
    crawlId,
    view: 'issue',
    filters: { group_id: groupId },
  });
  return (
    <Button variant="secondary" onClick={() => void run('csv')} pending={exporting !== null}>
      <Icon icon={Download} />
      Export CSV
    </Button>
  );
}
