import { useSyncExternalStore } from 'react';
import { z } from 'zod';

import type { SidebarGroup } from './route-types';

const STORAGE_KEY = 'citeladder:app:sidebar-folds';

const foldsSchema = z.array(z.string());

const listeners = new Set<() => void>();
let volatile: readonly string[] | null = null;
let snapshot: { raw: string | null; folds: readonly string[] } = { raw: null, folds: [] };

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function read(): readonly string[] {
  if (volatile !== null) return volatile;
  const raw = readRaw();
  if (raw === snapshot.raw) return snapshot.folds;
  let folds: readonly string[] = [];
  try {
    const parsed = foldsSchema.safeParse(raw ? JSON.parse(raw) : []);
    if (parsed.success) folds = parsed.data;
  } catch {}
  snapshot = { raw, folds };
  return folds;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

export function setGroupFolded(group: SidebarGroup, folded: boolean): void {
  const next = read().filter((entry) => entry !== group);
  if (folded) next.push(group);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    volatile = null;
  } catch {
    volatile = next;
  }
  for (const listener of listeners) listener();
}

export function isGroupFolded(group: SidebarGroup): boolean {
  return read().includes(group);
}

export function useGroupFolded(group: SidebarGroup): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isGroupFolded(group),
    () => false,
  );
}
