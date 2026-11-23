export const AGENT_STREAM_REPAINT_MS = { floor: 50, cap: 250 } as const;
export const AGENT_STREAM_NOTIFY_FALLBACK_MS = 100;

export const AGENT_CHAT_PAGE_SIZE = 30;
export const AGENT_RUN_POLL_STEPS: readonly { untilMs: number; everyMs: number }[] = [
  { untilMs: 30_000, everyMs: 2_000 },
  { untilMs: 120_000, everyMs: 5_000 },
];
export const AGENT_RUN_POLL_MAX_MS = 10_000;
export const AGENT_PAGE_FETCH_POLL_MS = 2_000;
export const AGENT_CHAT_LIST_POLL_MS = 5_000;
export const AGENT_STREAM_IDLE_MS = 30_000;
export const AGENT_RUN_RETRY = { defaultDelayMs: 15_000, maxAttempts: 8 } as const;
export const AGENT_FOLLOW_LATEST_GAP_PX = 96;
export const ACTIONS_GROUPING_PAGE_SIZE = 10;
export const AGENT_TOP_ACTIONS = 3;
export const AGENT_CHAT_SEARCH_DEBOUNCE_MS = 250;
export const ANALYZE_PAGE_SEARCH_DEBOUNCE_MS = 250;
export const AGENT_MENTION_SEARCH_LIMIT = 20;
export const AGENT_MENTION_SEARCH_DEBOUNCE_MS = 200;
export const AGENT_COMPOSER_MAX_ROWS = 8;
export const AGENT_PASTE_ATTACHMENT_MIN_CHARS = 2_000;
export const AGENT_BRIEFING_ACTIONS = 5;
