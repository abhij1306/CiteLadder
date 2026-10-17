'use client';

import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { integrationsApi } from '@/lib/api/integrations';
import { hardNavigate } from '@/lib/navigation/hard-navigate';

/**
 * Settings → Integrations when the workspace has no connections yet. It is the
 * same card shape as the Crawl logs card below it — title left, connect
 * actions right — so the page's buttons share one column.
 *
 * Both CTAs are full-page navigations to the same-origin OAuth start
 * endpoints (302s — never apiClient fetches): one Google consent links Search
 * Console + Analytics 4 on a shared grant; Bing needs its own consent because
 * a Google token cannot authorize Bing Webmaster Tools (the Bing account
 * itself may still have been created with a Google ID).
 */
export function IntegrationsEmptyState({ workspaceId }: Readonly<{ workspaceId: string }>) {
  return (
    <Card data-testid="integrations-empty-state">
      <CardHeader
        className="pb-[var(--card-padding)]"
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => hardNavigate(integrationsApi.oauthStartUrl('bing', workspaceId))}
            >
              Connect Bing
            </Button>
            <Button
              size="sm"
              onClick={() => hardNavigate(integrationsApi.oauthStartUrl('gsc', workspaceId))}
            >
              Connect Google
            </Button>
          </>
        }
      >
        <CardTitle>No integrations connected</CardTitle>
        <CardDescription>
          One Google consent connects Search Console and Analytics 4. Bing Webmaster Tools needs its
          own sign-in.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
