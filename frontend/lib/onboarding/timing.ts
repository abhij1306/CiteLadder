type TimingNames = Readonly<{ entry: string; start: string; end: string }>;

const COMPLETION_REQUEST: TimingNames = {
  entry: 'onboarding:completion-request',
  start: 'onboarding:completion-request:start',
  end: 'onboarding:completion-request:end',
};
const NAVIGATION_HANDOFF: TimingNames = {
  entry: 'onboarding:navigation-handoff',
  start: 'onboarding:navigation-handoff:start',
  end: 'onboarding:navigation-handoff:end',
};

function startTiming(timing: TimingNames, detail?: string): boolean {
  const performanceApi = globalThis.performance;
  if (typeof performanceApi?.mark !== 'function' || typeof performanceApi.measure !== 'function') {
    return false;
  }
  try {
    // Static entry names retain only the latest onboarding transaction.
    performanceApi.clearMeasures(timing.entry);
    performanceApi.clearMarks(timing.start);
    performanceApi.clearMarks(timing.end);
    performanceApi.mark(timing.start, detail === undefined ? undefined : { detail });
    return true;
  } catch {
    return false;
  }
}

function finishTiming(timing: TimingNames, started: boolean) {
  if (!started) return;
  const performanceApi = globalThis.performance;
  try {
    performanceApi.mark(timing.end);
    performanceApi.measure(timing.entry, timing.start, timing.end);
  } catch {
    // Best-effort observability must never block project creation or navigation.
  } finally {
    performanceApi.clearMarks(timing.start);
    performanceApi.clearMarks(timing.end);
  }
}

/** Begin the accepted-completion HTTP boundary. */
export function startOnboardingCompletionRequest(): boolean {
  return startTiming(COMPLETION_REQUEST);
}

/** Finish the accepted-completion HTTP boundary, including failed requests. */
export function finishOnboardingCompletionRequest(started: boolean) {
  finishTiming(COMPLETION_REQUEST, started);
}

/** Start the route handoff and bind it to the exact committed project. */
export function startOnboardingNavigationHandoff(projectId: string) {
  startTiming(NAVIGATION_HANDOFF, projectId);
}

/** Finish only after `/projects` renders with the same resolved project. */
export function finishOnboardingNavigationHandoff(projectId: string) {
  const performanceApi = globalThis.performance;
  if (typeof performanceApi?.getEntriesByName !== 'function') return;
  const marks = performanceApi.getEntriesByName(NAVIGATION_HANDOFF.start, 'mark');
  const activeMark = marks.at(-1) as PerformanceMark | undefined;
  if (activeMark?.detail !== projectId) return;
  finishTiming(NAVIGATION_HANDOFF, true);
}
