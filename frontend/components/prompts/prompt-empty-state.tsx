import { MessageSquarePlus } from '@/lib/icons';
import { StateBlock } from '@/components/ui/state-block';

import { AddPromptsMenu, type AddPromptsHandlers } from './prompt-toolbar';

export function PromptEmptyState({
  add,
}: Readonly<{
  add?: AddPromptsHandlers;
}>) {
  if (!add) {
    return <StateBlock kind="empty" icon={MessageSquarePlus} heading="No prompts tracked yet" />;
  }
  return (
    <StateBlock
      kind="empty"
      icon={MessageSquarePlus}
      heading="Choose the questions you want to track"
      action={<AddPromptsMenu {...add} />}
    />
  );
}
