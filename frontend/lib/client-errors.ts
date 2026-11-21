import {
  CLIENT_ERROR_FIELD_LIMITS,
  withoutQueryStrings,
  type ClientErrorKind,
  type ClientReport,
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

const CHUNK_LOAD_MESSAGES = [
  'Failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'Importing a module script failed',
  'Unable to preload CSS',
];

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'ChunkLoadError' ||
    CHUNK_LOAD_MESSAGES.some((text) => error.message.includes(text))
  );
}

export function releaseId(): string {
  const value = document
    .querySelector<HTMLMetaElement>(`meta[name="${RELEASE_META_NAME}"]`)
    ?.getAttribute('content');
  return value && /^[\w.-]{1,64}$/u.test(value) ? value : 'development';
}

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

function claimSlot(): boolean {
  let count = memoryCount;
  try {
    count = Math.max(count, Number(sessionStorage.getItem(COUNT_KEY)) || 0);
  } catch {}
  if (count >= CLIENT_ERROR_REPORTS_PER_SESSION) return false;
  memoryCount = count + 1;
  try {
    sessionStorage.setItem(COUNT_KEY, String(memoryCount));
  } catch {}
  return true;
}

export function reportClientError({
  kind,
  error,
  component,
}: Readonly<{ kind: ClientErrorKind; error: unknown; component?: string }>): void {
  const limits = CLIENT_ERROR_FIELD_LIMITS;
  if (typeof error === 'object' && error !== null) {
    if (sentErrors.has(error)) return;
    sentErrors.add(error);
  }
  const described = describe(error);
  const message = clip(withoutQueryStrings(described.message).trim(), limits.message) || 'Error';
  const signature = [kind, component ?? '', message].join('\n');
  if (sent.has(signature)) return;
  sent.add(signature);
  sendClientReport({
    kind,
    message,
    stack:
      described.stack === null ? null : clip(withoutQueryStrings(described.stack), limits.stack),
    route: reportRoute(),
    release: releaseId(),
    ...(component ? { component } : {}),
  });
}

export function reportRoute(): string {
  return clip(window.location.pathname, CLIENT_ERROR_FIELD_LIMITS.route);
}

export function sendClientReport(report: ClientReport): void {
  if (!claimSlot()) return;
  fetch(`${API_BASE_URL}/client-errors`, {
    method: 'POST',
    keepalive: true,
    priority: 'low',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(reportingWorkspace ? { 'X-Workspace-Id': reportingWorkspace } : {}),
    },
    body: JSON.stringify(report),
  }).catch(() => undefined);
}

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
