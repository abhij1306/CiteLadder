/**
 * The API host's origin for display in the app (crawl-log endpoints, the REST
 * API, MCP). A self-hosted CiteLadder serves the app and the API from one
 * origin, so it is the origin the browser is already on.
 */
export const API_HOST_ORIGIN =
  typeof window === 'undefined' ? 'http://127.0.0.1:8100' : window.location.origin;
