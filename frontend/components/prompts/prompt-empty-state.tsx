'use client';

import { MessageSquarePlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * Shown when the active project's prompt set has no prompts. Onboarding creates
 * none, so this is the first thing a new project's library shows. Generating
 * is the primary path; adding by hand is the equal alternative, and CSV import
 * stays in the page actions.
 */
export function PromptEmptyState({
  onGenerate,
  onAdd,
}: Readonly<{ onGenerate: () => void; onAdd: () => void }>) {
  return (
    <EmptyState
      icon={MessageSquarePlus}
      heading="Choose the questions you want to track"
      description="Generate buyer questions from your confirmed offerings, or add your own."
      action={
        <>
          <Button onClick={onGenerate}>Generate prompts</Button>
          <Button variant="secondary" onClick={onAdd}>
            Add prompt
          </Button>
        </>
      }
    />
  );
}
