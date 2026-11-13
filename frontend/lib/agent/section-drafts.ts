import { useSyncExternalStore } from 'react';

/**
 * Unsaved section edits, held for the life of the pane so switching revision or
 * document does not drop them. A draft lives until it is saved or discarded.
 */
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

/** The draft for one section, or undefined when none is kept. */
export function useSectionDraft(key: string): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => drafts.get(key),
    () => undefined,
  );
}

/** Test seam: forget every draft. */
export function resetSectionDrafts(): void {
  drafts.clear();
  emit();
}
