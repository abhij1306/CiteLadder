import { createContext, useContext } from 'react';

import type {
  ActionsView,
  useOpenLevels,
  useTreeSelection,
} from '@/components/agent/use-actions-page';
import type { ProjectScope } from '@/lib/api/query-keys/scope';

type ActionsPageContextValue = Readonly<{
  scope: ProjectScope;
  view: ActionsView;
  levels: ReturnType<typeof useOpenLevels>;
  selection: ReturnType<typeof useTreeSelection>;
}>;

export const ActionsPageContext = createContext<ActionsPageContextValue | null>(null);

export function useActionsPageContext(): ActionsPageContextValue {
  const value = useContext(ActionsPageContext);
  if (!value) throw new Error('The Actions tree renders inside ActionsPageContext.');
  return value;
}
