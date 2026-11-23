import type { ServiceConfig } from '../config.ts';
import type { Database } from '../db/database.ts';
import type { ToolCall } from '../models/conversation.ts';
import { authorize } from './access.ts';
import {
  editDocument,
  loadSkill,
  saveDocument,
  suggestEdits,
  EDIT_DOCUMENT,
  LOAD_SKILL,
  SUGGEST_EDITS,
  type BuiltinOutcome,
} from './builtin-tools.ts';
import type { SkillCatalog } from './contracts.ts';
import { proposeChange, PROPOSE_CHANGE } from './change-proposals.ts';
import { knownActions, proposeDeclaration, PROPOSE_DECLARATION } from './proposals.ts';
import type { Turn } from './runtime.ts';
import type { TurnState } from './turn-budget.ts';
import { documentStep } from './turn-state.ts';
import { showView, SHOW_VIEW } from './views.ts';

type BuiltinCall = { turn: Turn; state: TurnState; call: ToolCall };

function projectBuiltin(
  db: Database,
  config: () => ServiceConfig,
  { turn, state, call }: BuiltinCall,
): Promise<BuiltinOutcome> | null {
  switch (call.name) {
    case PROPOSE_CHANGE:
      return authorize(db, turn.scope).then(() =>
        proposeChange(db, config(), { scope: turn.scope, state }, call.input),
      );
    case PROPOSE_DECLARATION:
      return db.transaction().execute(async (trx) => {
        await authorize(trx, turn.scope);
        const proposal = {
          scope: turn.scope,
          known: knownActions(turn.manifest, state.read),
          documents: turn.documents,
        };
        return proposeDeclaration(trx, proposal, state, call.input);
      });
    case SHOW_VIEW:
      return authorize(db, turn.scope).then(() => showView(db, turn.scope, state, call.input));
    default:
      return null;
  }
}

export async function runBuiltin(
  db: Database,
  { catalog, config }: { catalog: SkillCatalog; config: () => ServiceConfig },
  { turn, state, call }: BuiltinCall,
): Promise<BuiltinOutcome> {
  const project = projectBuiltin(db, config, { turn, state, call });
  if (project) return project;
  if (call.name === LOAD_SKILL) {
    const before = state.skill;
    const outcome = loadSkill(catalog, state, call.input, turn.budget);
    if (outcome.ok && state.skill && before?.id !== state.skill.id)
      state.steps.push({ kind: 'skill', skill_id: state.skill.id });
    return Promise.resolve(outcome);
  }
  if (call.name === SUGGEST_EDITS) {
    const outcome = suggestEdits(catalog, state, call.input, turn.budget);
    if (outcome.ok) state.steps.push({ kind: 'suggestion' });
    return Promise.resolve(outcome);
  }
  const edit = call.name === EDIT_DOCUMENT;
  const outcome = edit
    ? editDocument(catalog, state, call.input, turn.budget)
    : saveDocument(catalog, state, call.input, turn.budget);
  if (outcome.ok && outcome.document)
    state.steps.push(documentStep(turn, state, { number: outcome.document, edit }));
  return Promise.resolve(outcome);
}
