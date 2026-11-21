import { useSyncExternalStore } from 'react';

const drafts = new Map<string, string>();
const listeners = new Set<() => void>();

export function sectionDraftKey(outputId: string, revisionId: string, section: number): string {
  return `${outputId}:${revisionId}:${section}`;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function setSectionDraft(key: string, text: string): void {
  if (drafts.get(key) === text) return;
  drafts.set(key, text);
  emit();
}

export function clearSectionDraft(key: string): void {
  if (drafts.delete(key)) emit();
}

export function useSectionDraft(key: string): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => drafts.get(key),
    () => undefined,
  );
}

export function resetSectionDrafts(): void {
  drafts.clear();
  emit();
}
