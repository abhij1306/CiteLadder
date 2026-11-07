/**
 * Agent workspace client policy: page sizes and the polling cadence that
 * follows an active turn. Reads never run the agent, so the UI polls the
 * persisted chat until the run reaches a terminal state.
 */
export const AGENT_CHAT_PAGE_SIZE = 30;
/** A turn without this tab's stream is polled quickly at first, then less often. */
export const AGENT_RUN_POLL_STEPS: readonly { untilMs: number; everyMs: number }[] = [
  { untilMs: 30_000, everyMs: 2_000 },
  { untilMs: 120_000, everyMs: 5_000 },
];
export const AGENT_RUN_POLL_MAX_MS = 10_000;
/** The chat list refreshes at this cadence while any listed chat has a turn running. */
export const AGENT_CHAT_LIST_POLL_MS = 5_000;
/**
 * A turn's stream that delivers no frame, keep-alives included, for this long
 * is closed and the persisted read takes over: twice the server's 15-second
 * `stream_heartbeat_seconds`.
 */
export const AGENT_STREAM_IDLE_MS = 30_000;
/**
 * A busy instance refuses a turn's stream with 429 and `Retry-After`; the
 * browser re-posts after that delay (this one when the header is missing), up
 * to this many attempts, then leaves the queued turn to the runner.
 */
export const AGENT_RUN_RETRY = { defaultDelayMs: 15_000, maxAttempts: 8 } as const;
/** Distance from the end that still counts as following the conversation. */
export const AGENT_FOLLOW_LATEST_GAP_PX = 96;
/**
 * Floors of an Action's priority bands. A crawl or catalog finding scores its
 * severity × 10 (critical 40, high 30, medium 20, low 10), so these keep its
 * band equal to its severity; a prompt gap's value and gap factors lift it.
 */
export const ACTION_PRIORITY_BANDS = { high: 30, medium: 20 } as const;
/** New chat shows this many top Actions under "Work on this". */
export const AGENT_TOP_ACTIONS = 3;
/** Debounce for the sidebar chat search. */
export const AGENT_CHAT_SEARCH_DEBOUNCE_MS = 250;
/**
 * Actions the composer's `@` menu matches against, loaded when the menu first
 * opens. The table's first page is too few to find an Action by name.
 */
export const AGENT_MENTION_POOL_SIZE = 50;
/** Top open Actions a briefing mentions (within the server's `mentions_max`). */
export const AGENT_BRIEFING_ACTIONS = 5;
