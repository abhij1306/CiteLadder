/** MCP protocol bounds and environment specifications. */
export const mcp = {
  settings: {
    // The static bearer token MCP clients send; unset disables MCP.
    token: {
      env: ['MCP_TOKEN'],
      type: 'str',
      default: '',
    },
  },
  constants: {
    ui_resource_uri: 'ui://citeladder/analytics/v1',
    ui_mime_type: 'text/html;profile=mcp-app',
    trend_max_window_days: 366,
    write_scope: 'citeladder:write',
    scopes_supported: ['citeladder:read', 'citeladder:write'],
    server_version: '2.0.0',
    // 2026-07-28 CacheableResult hints. Catalogue documents are the same for
    // every caller; the tool list follows the grant; project reads are live.
    result_cache: {
      catalogue: { ttlMs: 3_600_000, cacheScope: 'public' },
      grant: { ttlMs: 3_600_000, cacheScope: 'private' },
      project: { ttlMs: 0, cacheScope: 'private' },
    },
    documentation_url: 'https://github.com/abhij1306/CiteLadder#connect-an-ai-assistant-mcp',
    max_search_results: 20,
    search_snippet_chars: 500,
    default_list_limit: 50,
    overview_action_limit: 10,
    default_search_limit: 10,
    max_list_limit: 200,
    // Pages one internal-link read names; each row carries sampled neighbors.
    max_link_pages: 10,
    // Neighbors per side when pages are named, so all of them fit one Agent tool result.
    named_link_page_neighbors: 3,
    // Per-page evidence lines a rule-filtered page read carries.
    rule_evidence_items: 3,
    max_document_bytes: 256000,
    protocol_cleanup_batch: 100,
    last_used_resolution_seconds: 300,
    tool_call_window_seconds: 60,
    tool_call_grant_limit: 120,
    tool_call_user_limit: 600,
    // Executed writes also spend this narrower per-grant budget, in the same window.
    write_call_grant_limit: 30,
    confirmation_ttl_seconds: 600,
    // Ended grants and confirmations are kept this long as audit evidence.
    protocol_retention_seconds: 15552000,
  },
};
