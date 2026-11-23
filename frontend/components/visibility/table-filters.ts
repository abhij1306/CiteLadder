import type { FilterDefinition } from '@/components/ui/all-filters';
import { useFanoutGroupFilter } from '@/components/visibility/fanout-evidence';
import { sourceTableFilters } from '@/components/visibility/source-filters';
import type { SourceFilters } from '@/components/visibility/source-rows';
import { optionalStringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import type { VisibilityView } from '@/lib/visibility/dashboard';
import {
  useSourceDomains,
  useSourceTypes,
  type SourceQueries,
} from '@/lib/visibility/use-source-analysis';

const PAGING = { clearKeys: ['source_cursor', 'source_offset', 'source_as_of'] };

function useSourceTableScope(view: VisibilityView) {
  const [url] = useUrlState('source_url', optionalStringUrlCodec);
  const sourcesTab = view === 'domains' || view === 'urls' || view === 'read-not-cited';
  if (!sourcesTab || url) return null;
  if (view === 'read-not-cited') return null;
  return { dimension: view === 'domains' ? ('domain' as const) : ('url' as const) };
}

export function useTableFilters({
  view,
  filters,
  queries,
}: Readonly<{
  view: VisibilityView;
  filters: SourceFilters;
  queries: SourceQueries;
}>): FilterDefinition[] {
  const groupFilter = useFanoutGroupFilter();
  const scope = useSourceTableScope(view);
  const [sourceType, setSourceType] = useUrlState('source_type', optionalStringUrlCodec, PAGING);
  const [standing, setStanding] = useUrlState('source_standing', optionalStringUrlCodec, PAGING);
  const [picked, setPicked] = useUrlState('source_pick', optionalStringUrlCodec, PAGING);
  const dimension = scope?.dimension ?? 'domain';
  const domainOptions = useSourceDomains(filters, queries, dimension === 'url');
  const activeDomain = dimension === 'url' ? picked : null;
  const types = useSourceTypes(filters, queries, {
    dimension,
    domain: activeDomain,
    enabled: scope !== null,
  });
  if (view === 'query-fanout') return [groupFilter];
  if (!scope) return [];
  return sourceTableFilters({
    dimension,
    type: { value: sourceType, options: types, onChange: setSourceType },
    standing: { gapOnly: standing === 'gap', onChange: setStanding },
    domain: { value: picked, options: domainOptions, onChange: setPicked },
  });
}
