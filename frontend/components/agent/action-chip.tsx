import { ActionStatusBadge } from '@/components/agent/action-status-badge';
import { RecordTag } from '@/components/ui/tag';
import type { AgentChatDetail } from '@/lib/api/agent';
import { readableUrl } from '@/lib/format';

type ChatAction = AgentChatDetail['actions'][number];

export function ActionChip({
  action,
  prefix = '',
}: Readonly<{ action: ChatAction; prefix?: string }>) {
  const url = /^https?:\/\//iu.test(action.target_label);
  return (
    <RecordTag
      href={`/actions/${action.id}`}
      label={`${prefix}${url ? readableUrl(action.target_label) : action.target_label}`}
      labelKind={url ? 'url' : 'text'}
      status={<ActionStatusBadge status={action.status} />}
    />
  );
}
