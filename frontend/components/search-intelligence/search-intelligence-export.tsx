import { useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { downloadCsv } from '@/lib/csv/download';
import {
  searchIntelligenceApi,
  type SearchIntelligenceDataset,
  type SearchIntelligenceRow,
} from '@/lib/api/search-intelligence';
import { SEARCH_COLUMNS_BY_KIND, searchScopeLabel } from '@/lib/config/search-intelligence';
import { useProjectContext } from '@/lib/project/project-context';

export function SearchIntelligenceExport({
  dataset,
  params,
}: Readonly<{
  dataset: SearchIntelligenceDataset;
  params: Parameters<typeof searchIntelligenceApi.rows>[3];
}>) {
  const { activeProject } = useProjectContext();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => controller.current?.abort(),
    [activeProject?.id, activeProject?.workspace_id],
  );
  const exportSaved = async () => {
    if (!activeProject) return;
    controller.current = new AbortController();
    const signal = controller.current.signal;
    setExporting(true);
    setExportError('');
    try {
      const exported: SearchIntelligenceRow[] = [];
      let cursor: string | undefined;
      do {
        const saved = await searchIntelligenceApi.rows(
          activeProject.id,
          dataset.id,
          { workspaceId: activeProject.workspace_id, signal },
          { ...params, cursor, limit: 200 },
        );
        exported.push(...saved.rows);
        cursor = saved.next_cursor ?? undefined;
      } while (cursor);
      signal.throwIfAborted();
      const columns = [
        ...new Set([
          'id',
          'call_id',
          ...(SEARCH_COLUMNS_BY_KIND[dataset.dataset_kind] ?? []).map(({ field }) => field),
          'rank_absolute',
          'cpc_currency',
          'first_seen',
          'provider_updated_at',
        ]),
      ];
      downloadCsv(
        `search-${dataset.id}`,
        ['snapshot', 'scope', 'target', 'market', 'language', 'collected_at', ...columns],
        exported.map((row) => [
          dataset.id,
          searchScopeLabel(dataset.research_scope),
          dataset.target_origin,
          dataset.location_code,
          dataset.language_code,
          dataset.collection_ended_at ?? '',
          ...columns.map((key) => String(row[key] ?? '')),
        ]),
      );
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Saved export failed');
    } finally {
      setExporting(false);
    }
  };
  return (
    <>
      <Button variant="ghost" size="sm" disabled={exporting} onClick={() => void exportSaved()}>
        {exporting ? 'Exporting…' : 'Export saved CSV'}
      </Button>
      {exportError ? <Alert>{exportError}</Alert> : null}
    </>
  );
}
