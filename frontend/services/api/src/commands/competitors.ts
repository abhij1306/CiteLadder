/** Tracked-competitor commands: add, edit, remove and accept a suggestion. */
import type { z } from 'zod';

import type { Database } from '../db/database.ts';
import type { ProjectScope } from '../projects/brand-profile.ts';
import { acceptSuggestion as acceptOwnedSuggestion } from '../projects/competitor-suggestions.ts';
import * as competitors from '../projects/competitors.ts';
import { permission, type Authorized } from './permission.ts';

export const COMPETITORS_WRITE = permission({ capability: 'write', scope: 'competitors:write' });
type Writer = Authorized<typeof COMPETITORS_WRITE>;

const scopeOf = (actor: Writer, projectId: string): ProjectScope => ({
  workspaceId: actor.workspaceId,
  projectId,
});

export function addCompetitor(
  db: Database,
  actor: Writer,
  projectId: string,
  input: z.output<typeof competitors.competitorCreate>,
) {
  return competitors.addCompetitor(db, scopeOf(actor, projectId), input);
}

export function updateCompetitor(
  db: Database,
  actor: Writer,
  projectId: string,
  competitorId: string,
  input: z.output<typeof competitors.competitorUpdate>,
) {
  return competitors.updateCompetitor(db, scopeOf(actor, projectId), competitorId, input);
}

export function removeCompetitor(
  db: Database,
  actor: Writer,
  projectId: string,
  competitorId: string,
) {
  return competitors.removeCompetitor(db, scopeOf(actor, projectId), competitorId);
}

export function acceptSuggestion(
  db: Database,
  actor: Writer,
  projectId: string,
  candidateId: string,
) {
  return acceptOwnedSuggestion(db, scopeOf(actor, projectId), candidateId);
}
