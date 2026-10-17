/**
 * Small query-string helpers shared by the per-domain API modules.
 * These own no transport — they only build relative paths.
 */
type QueryParamValue = string | number | boolean | readonly string[] | null | undefined;

export function definedQuery<T extends Record<string, QueryParamValue>>(params?: T) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null) {
      if (Array.isArray(value)) for (const item of value) query.append(key, item);
      else query.set(key, String(value));
    }
  }
  return query;
}

export function withQuery(path: string, query: URLSearchParams) {
  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}
