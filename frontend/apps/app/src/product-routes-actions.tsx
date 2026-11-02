import { ActionDetailScreen } from '@/components/agent/action-detail-screen';
import { ActionsScreen } from '@/components/agent/actions-screen';

/** `/agent/actions`: Actions by deterministic priority, filterable. */
export function ActionsRouteElement() {
  return <ActionsScreen />;
}

/** `/agent/actions/:actionId`: diagnosis, members and linked chats. */
export function ActionDetailRouteElement() {
  return <ActionDetailScreen />;
}
