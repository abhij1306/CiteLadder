import { useContext, useEffect } from 'react';
import { UNSAFE_DataRouterContext, useBlocker, type Location } from 'react-router-dom';

import { ConfirmDialog } from '@/components/ui/dialog';

/**
 * Warns before unsaved edits are discarded: the browser's own prompt on tab
 * close or reload, and a confirmation before an in-app navigation that leaves
 * the screen (another path, or another project). Navigation within the screen,
 * such as a tab held in the URL, passes.
 */
export function UnsavedChangesGuard({ when }: Readonly<{ when: boolean }>) {
  useEffect(() => {
    if (!when) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [when]);
  // Blocking needs the data router the app runs in; a plain router (an
  // isolated component render) keeps the tab-close warning alone. The router
  // consults only its last-registered blocker, so only an unsaved guard
  // registers one: a clean guard mounted later (another output on the same
  // chat) must not displace it.
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  return dataRouter && when ? <NavigationGuard /> : null;
}

function leavesScreen(current: Location, next: Location): boolean {
  const project = (location: Location) => new URLSearchParams(location.search).get('project');
  return current.pathname !== next.pathname || project(current) !== project(next);
}

function NavigationGuard() {
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    leavesScreen(currentLocation, nextLocation),
  );
  return (
    <ConfirmDialog
      onCancel={() => blocker.reset?.()}
      request={
        blocker.state === 'blocked'
          ? {
              title: 'Discard unsaved changes?',
              body: 'Your edits are not saved. Leaving discards them.',
              confirmLabel: 'Discard and leave',
              destructive: true,
              onConfirm: () => blocker.proceed(),
            }
          : null
      }
    />
  );
}
