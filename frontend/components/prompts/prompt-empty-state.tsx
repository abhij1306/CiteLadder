import { MessageSquarePlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { QueryState } from '@/components/ui/query-state';

/**
 * Shown when the active project's prompt set has no prompts. Onboarding creates
 * none, so this is the first thing a new project's library shows. Generating
 * is the primary path; adding by hand is the equal alternative, and CSV import
 * stays in the page actions. A role that may not add prompts reads that there
 * are none, with nothing to choose.
 */
export function PromptEmptyState({
  add,
}: Readonly<{
  /** The ways to add prompts, for a role that may; omitted otherwise. */
  add?: Readonly<{ onGenerate: () => void; onAdd: () => void }>;
}>) {
  if (!add) {
    return (
      <QueryState
        kind="empty"
        icon={MessageSquarePlus}
        heading="No prompts tracked yet"
        description="This project does not track any questions yet."
      />
    );
  }
  const { onGenerate, onAdd } = add;
  return (
    <QueryState
      kind="empty"
      icon={MessageSquarePlus}
      heading="Choose the questions you want to track"
      description="Generate buyer questions from your confirmed offerings, or add your own."
      action={
        <>
          <Button variant="primary" onClick={onGenerate}>
            Generate prompts
          </Button>
          <Button variant="secondary" onClick={onAdd}>
            Add prompt
          </Button>
        </>
      }
    />
  );
}
