import { useContext, useEffect } from 'react';
import { UNSAFE_DataRouterContext, useBlocker, type Location } from 'react-router-dom';

import { ConfirmDialog } from '@/components/ui/dialog';

export function UnsavedChangesGuard({ when }: Readonly<{ when: boolean }>) {
  useEffect(() => {
    if (!when) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [when]);
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
