'use client';

import { Suspense } from 'react';

import { RouteLoadingScreen } from '@/components/layout/page-shell';

import { SettingsScreen } from './settings-screen';

/** Shared settings route, including URL-backed settings tabs. */
export function SettingsRouteContent() {
  return (
    <Suspense fallback={<RouteLoadingScreen />}>
      <SettingsScreen />
    </Suspense>
  );
}
