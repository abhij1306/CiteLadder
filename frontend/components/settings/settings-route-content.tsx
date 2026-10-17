'use client';

import { Suspense } from 'react';

import { SettingsScreen } from './settings-screen';

/** Shared settings route, including URL-backed settings tabs. */
export function SettingsRouteContent() {
  return (
    <Suspense>
      <SettingsScreen />
    </Suspense>
  );
}
