/** Tracked-competitor commands: add, edit, remove and accept a suggestion. */
import type { z } from 'zod';

import type { Database } from '../db/database.ts';
import type { ProjectScope } from '../projects/brand-profile.ts';
import { acceptSuggestion as acceptOwnedSuggestion } from '../projects/competitor-suggestions.ts';
import * as competitors from '../projects/competitors.ts';
import { permission, type Authorized } from './permission.ts';

export const COMPETITORS_WRITE = permission({ capability: 'write', scope: 'competitors:write' });
export type CompetitorWriter = Authorized<typeof COMPETITORS_WRITE>;

const scopeOf = (actor: CompetitorWriter, projectId: string): ProjectScope => ({
  workspaceId: actor.workspaceId,
  projectId,
});

export function addCompetitor(
  db: Database,
  actor: CompetitorWriter,
  projectId: string,
  input: z.output<typeof competitors.competitorCreate>,
) {
  return competitors.addCompetitor(db, scopeOf(actor, projectId), input);
}

export function updateCompetitor(
  db: Database,
  actor: CompetitorWriter,
  projectId: string,
  competitorId: string,
  input: z.output<typeof competitors.competitorUpdate>,
) {
  return competitors.updateCompetitor(db, scopeOf(actor, projectId), competitorId, input);
}

/** The project editor's save: the whole list, written as a diff that keeps tracked rows. */
export function saveCompetitorList(
  db: Database,
  actor: CompetitorWriter,
  projectId: string,
  items: Parameters<typeof competitors.saveCompetitorList>[2],
) {
  return competitors.saveCompetitorList(db, scopeOf(actor, projectId), items);
}

export function removeCompetitor(
  db: Database,
  actor: CompetitorWriter,
  projectId: string,
  competitorId: string,
) {
  return competitors.removeCompetitor(db, scopeOf(actor, projectId), competitorId);
}

export function acceptSuggestion(
  db: Database,
  actor: CompetitorWriter,
  projectId: string,
  candidateId: string,
) {
  return acceptOwnedSuggestion(db, scopeOf(actor, projectId), candidateId);
}
