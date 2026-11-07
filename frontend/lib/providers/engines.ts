/**
 * The engine catalogue as the browser reads it: which logical engines exist,
 * what each is called, their display order and how each is reached. All of it
 * comes from `/provider-catalog`, which derives it from the backend's provider
 * routes; the browser keeps no engine list of its own.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { providersApi } from '@/lib/api/providers';
import { queryKeys } from '@/lib/api/query-keys';
import type { LogicalEngine, ProviderCatalog, SurfaceKind } from '@citeladder/contracts';

type EngineCatalog = {
  /** Every routed engine, in display order. */
  order: readonly LogicalEngine[];
  /** The engine's display name; a key the catalogue does not list prints as stored. */
  label: (key: string) => string;
  /** How the engine's route is reached; null for a key the catalogue does not list. */
  surfaceKind: (key: string) => SurfaceKind | null;
  /**
   * Observed rather than asked: a consumer app or results page reached through
   * DataForSEO. Nothing is sent to it, so it has no model or retrieval state.
   */
  isObserved: (key: string) => boolean;
  /** An observed search results surface (`search_ai`), such as Google AI Overview. */
  isSearchSurface: (key: string) => boolean;
  /**
   * A route's model as the product names it. An asked engine's model is real
   * provenance a reader compares runs by; an observed surface's is the
   * vendor's endpoint name, which describes our plumbing, so it is null.
   */
  modelLabel: (engine: string, model: string | null | undefined) => string | null;
};

/** The catalogue view of a `/provider-catalog` payload; empty until it arrives. */
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
    // Only a catalogued LLM route has a model the request pinned; an observed
    // surface or an engine the catalogue does not know shows none.
    modelLabel: (engine, model) => (model && surfaceKind(engine) === 'llm' ? model : null),
  };
}

/** The engine catalogue, read once per session: it changes only with a deploy. */
export function useEngineCatalog(): EngineCatalog {
  const { data } = useQuery({
    queryKey: queryKeys.providers.catalog(),
    queryFn: ({ signal }) => providersApi.getCatalog({ signal, workspaceId: null }),
    staleTime: Infinity,
  });
  return useMemo(() => engineCatalog(data), [data]);
}
