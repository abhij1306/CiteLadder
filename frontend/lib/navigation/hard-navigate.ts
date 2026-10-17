/**
 * A full-page navigation that deliberately leaves the SPA.
 *
 * Integration OAuth needs this rather than client routing: the browser must
 * follow the API's redirect to the provider's consent screen. That is "leave
 * this app", not "route within it".
 *
 * It exists as a named function because `window.location.assign` cannot be
 * intercepted in jsdom, so a component calling it directly is untestable —
 * the assertion "this click navigated instead of posting" is exactly the one
 * worth making about an OAuth hand-off.
 */
export function hardNavigate(url: string): void {
  window.location.assign(url);
}
