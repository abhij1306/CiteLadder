import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { providersApi } from '@/lib/api/providers';
import { queryKeys } from '@/lib/api/query-keys';
import type { LogicalEngine, ProviderCatalog, SurfaceKind } from '@citeladder/contracts';

type EngineCatalog = {
  order: readonly LogicalEngine[];
  label: (key: string) => string;
  surfaceKind: (key: string) => SurfaceKind | null;
  isObserved: (key: string) => boolean;
  isSearchSurface: (key: string) => boolean;
  modelLabel: (engine: string, model: string | null | undefined) => string | null;
};

export function engineCatalog(catalog: ProviderCatalog | undefined): EngineCatalog {
  const engines = catalog?.engines ?? [];
  const byKey = new Map<string, (typeof engines)[number]>(
    engines.map((engine) => [engine.logical_engine, engine]),
  );
  const surfaceKind = (key: string) => byKey.get(key)?.routes[0]?.surface_kind ?? null;
  const isObserved = (key: string) => {
    const kind = surfaceKind(key);
    return kind !== null && kind !== 'llm';
  };
  return {
    order: engines.map((engine) => engine.logical_engine),
    label: (key) => byKey.get(key)?.label ?? key,
    surfaceKind,
    isObserved,
    isSearchSurface: (key) => surfaceKind(key) === 'search_ai',
    modelLabel: (engine, model) => (model && surfaceKind(engine) === 'llm' ? model : null),
  };
}

export function useEngineCatalog(): EngineCatalog {
  const { data } = useQuery({
    queryKey: queryKeys.providers.catalog(),
    queryFn: ({ signal }) => providersApi.getCatalog({ signal, workspaceId: null }),
    staleTime: Infinity,
  });
  return useMemo(() => engineCatalog(data), [data]);
}
