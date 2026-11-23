import { apiClient, type ApiRequestOptions } from '@/lib/api/client';
import {
  siteHealthApi,
  type ExportFilters,
  type ExportFormat,
  type ExportView,
} from '@/lib/api/site-health';
import { saveBlob } from '@/lib/download';

export function exportFilename(crawlId: string, format: ExportFormat, view: ExportView): string {
  return `site-health-${view}-${crawlId.slice(0, 8)}.${format}`;
}

export async function downloadCrawlExport(
  {
    crawlId,
    format,
    view,
    filters,
  }: Readonly<{
    crawlId: string;
    format: ExportFormat;
    view: ExportView;
    filters?: ExportFilters;
  }>,
  options?: ApiRequestOptions,
): Promise<void> {
  const absolutePath = siteHealthApi.exportUrl(crawlId, format, view, filters);
  const path = absolutePath.replace(/^\/api\/v1/, '');
  const blob = await apiClient.getBlob(path, options);
  saveBlob(blob, exportFilename(crawlId, format, view));
}
