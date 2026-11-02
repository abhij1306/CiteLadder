/**
 * Fire-and-forget reports of browser failures to the same-origin error sink
 * (`POST /api/v1/client-errors`), so a screen that broke for a reader leaves a
 * trace in the API's logs. A report names the failure and the screen's path,
 * never its query string or what the reader typed; the API takes who reported
 * it from the session. One error is sent once per page load, and a tab stops
 * after `CLIENT_ERROR_REPORTS_PER_SESSION` reports.
 */
import {
  CLIENT_ERROR_FIELD_LIMITS,
  withoutQueryStrings,
  type ClientErrorKind,
  type ClientErrorReport,
} from '@citeladder/contracts/client-errors';

import {
  API_BASE_URL,
  CLIENT_ERROR_REPORTS_PER_SESSION,
  RELEASE_META_NAME,
} from '@/lib/config/operational';

const COUNT_KEY = 'citeladder.client-error-reports';
const sent = new Set<string>();
const sentErrors = new WeakSet<object>();
let memoryCount = 0;
let listening = false;
let reportingWorkspace: string | null = null;

/** What browsers say when a lazily imported module (a code chunk) cannot load. */
const CHUNK_LOAD_MESSAGES = [
  'Failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'Importing a module script failed',
  'Unable to preload CSS',
];

/** Whether an error is a code chunk that failed to download, as after a deploy replaced it. */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'ChunkLoadError' ||
    CHUNK_LOAD_MESSAGES.some((text) => error.message.includes(text))
  );
}

/** Read at report time from index.html, which the build writes and no chunk hash covers. */
function releaseId(): string {
  const value = document
    .querySelector<HTMLMetaElement>(`meta[name="${RELEASE_META_NAME}"]`)
    ?.getAttribute('content');
  return value && /^[\w.-]{1,64}$/u.test(value) ? value : 'development';
}

/**
 * The active workspace, sent as `X-Workspace-Id` the way other API calls send
 * it. The API records it only when the session is a member; with none, a
 * report names no workspace.
 */
export function setReportingWorkspace(workspaceId: string | null): void {
  reportingWorkspace = workspaceId;
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

function describe(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error)
    return { message: error.message || error.name, stack: error.stack ?? null };
  return { message: typeof error === 'string' ? error : 'Non-error value thrown', stack: null };
}

/** Claim one of the tab's report slots; storage that throws falls back to this page load. */
function claimSlot(): boolean {
  let count = memoryCount;
  try {
    count = Math.max(count, Number(sessionStorage.getItem(COUNT_KEY)) || 0);
  } catch {
    // Storage blocked: the page-load count still bounds this document.
  }
  if (count >= CLIENT_ERROR_REPORTS_PER_SESSION) return false;
  memoryCount = count + 1;
  try {
    sessionStorage.setItem(COUNT_KEY, String(memoryCount));
  } catch {
    // As above.
  }
  return true;
}

/** Send one report, unless this error was already sent or the tab's budget is spent. */
export function reportClientError({
  kind,
  error,
  component,
}: Readonly<{ kind: ClientErrorKind; error: unknown; component?: string }>): void {
  const limits = CLIENT_ERROR_FIELD_LIMITS;
  // A boundary that rethrows hands the same error to the next one: one report.
  if (typeof error === 'object' && error !== null) {
    if (sentErrors.has(error)) return;
    sentErrors.add(error);
  }
  const described = describe(error);
  const message = clip(withoutQueryStrings(described.message).trim(), limits.message) || 'Error';
  const signature = [kind, component ?? '', message].join('\n');
  if (sent.has(signature)) return;
  sent.add(signature);
  if (!claimSlot()) return;
  const report: ClientErrorReport = {
    kind,
    message,
    stack:
      described.stack === null ? null : clip(withoutQueryStrings(described.stack), limits.stack),
    route: clip(window.location.pathname, limits.route),
    release: releaseId(),
    ...(component ? { component } : {}),
  };
  // A report must never become a second failure, so every rejection is dropped.
  fetch(`${API_BASE_URL}/client-errors`, {
    method: 'POST',
    keepalive: true,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(reportingWorkspace ? { 'X-Workspace-Id': reportingWorkspace } : {}),
    },
    body: JSON.stringify(report),
  }).catch(() => undefined);
}

/** Report errors nothing else caught; installed once, at application start. */
export function installClientErrorListeners(): void {
  if (listening) return;
  listening = true;
  const kindOf = (error: unknown): ClientErrorKind =>
    isChunkLoadError(error) ? 'chunk_load' : 'unhandled';
  window.addEventListener('error', (event) => {
    const error: unknown = event.error ?? event.message;
    reportClientError({ kind: kindOf(error), error });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason;
    reportClientError({ kind: kindOf(reason), error: reason });
  });
}
