'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Stack } from '@/components/ui/layout';
import { ProviderList } from '@/components/providers/provider-list';

/**
 * BYOK Provider Settings panel, rendered inside the Settings screen's
 * "Providers" tab.
 *
 * Measurement credentials come first as one list row per provider — a
 * DataForSEO login is entered once and serves every consumer-app and search
 * surface. The Agent always runs on the platform model.
 */
export function ProviderSettings() {
  return (
    <Stack gap="workspace">
      <Card>
        <CardHeader>
          <CardTitle>Measurement providers</CardTitle>
          <CardDescription>
            Bring your own credentials. Each provider is entered once and measures every engine
            listed with it. Saving runs a connection test; stored secrets are never displayed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProviderList />
        </CardContent>
      </Card>
    </Stack>
  );
}
