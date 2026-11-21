import { Button } from '@/components/ui/button';
import { StateBlock } from '@/components/ui/state-block';
import { ICONS } from '@/lib/icons';
import { integrationsApi } from '@/lib/api/integrations';
import { hardNavigate } from '@/lib/navigation/hard-navigate';
import { useWorkspaceCapability } from '@/lib/project/project-context';

export function IntegrationsEmptyState({ workspaceId }: Readonly<{ workspaceId: string }>) {
  const canManage = useWorkspaceCapability('manage_credentials');
  return (
    <StateBlock
      kind="empty"
      icon={ICONS.connect}
      heading="No integrations connected"
      description={canManage ? undefined : 'Owner or Admin only.'}
      action={
        canManage ? (
          <>
            <Button onClick={() => hardNavigate(integrationsApi.oauthStartUrl('gsc', workspaceId))}>
              Connect Google
            </Button>
            <Button
              variant="secondary"
              onClick={() => hardNavigate(integrationsApi.oauthStartUrl('bing', workspaceId))}
            >
              Connect Bing
            </Button>
          </>
        ) : undefined
      }
    />
  );
}
