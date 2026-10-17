/** Tracked-competitor commands: add, edit, remove and accept a suggestion. */
import type { z } from 'zod';

import { requireCapability, type Actor } from '../auth/actor.ts';
import type { Database } from '../db/database.ts';
import type { ProjectScope } from '../projects/brand-profile.ts';
import { acceptSuggestion as acceptOwnedSuggestion } from '../projects/competitor-suggestions.ts';
import * as competitors from '../projects/competitors.ts';

function scopeOf(actor: Actor, projectId: string): ProjectScope {
  requireCapability(actor, 'write', 'competitors:write');
  return { workspaceId: actor.workspaceId, projectId };
}

export function addCompetitor(
  db: Database,
  actor: Actor,
  projectId: string,
  input: z.output<typeof competitors.competitorCreate>,
) {
  return competitors.addCompetitor(db, scopeOf(actor, projectId), input);
}

export function updateCompetitor(
  db: Database,
  actor: Actor,
  projectId: string,
  competitorId: string,
  input: z.output<typeof competitors.competitorUpdate>,
) {
  return competitors.updateCompetitor(db, scopeOf(actor, projectId), competitorId, input);
}

export function removeCompetitor(
  db: Database,
  actor: Actor,
  projectId: string,
  competitorId: string,
) {
  return competitors.removeCompetitor(db, scopeOf(actor, projectId), competitorId);
}

export function acceptSuggestion(
  db: Database,
  actor: Actor,
  projectId: string,
  candidateId: string,
) {
  return acceptOwnedSuggestion(db, scopeOf(actor, projectId), candidateId);
}
