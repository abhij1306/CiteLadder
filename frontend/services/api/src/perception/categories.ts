import { countedMatches } from '../analysis/entity-assessment.ts';
import type { PerceptionPolicy } from '../config/perception.ts';
import type { Database } from '../db/database.ts';
import { cleanName, lockThemes, nameKey, saveModelThemes } from '../projects/themes.ts';
import type { DropReason, EntitySentiment, ExtractedAspect, VerifiedAspect } from './validate.ts';

export type CategoryChoice =
  | { kind: 'theme'; theme_id: string }
  | { kind: 'new'; name: string }
  | { kind: 'other' };

type Names = { policy: Pick<PerceptionPolicy, 'project_themes'>; businesses: readonly string[] };
type ThemeName = { id: string; name: string };

const words = (name: string) => name.split(' ').filter(Boolean).length;
const PLAIN = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} '’&+\-/,.]*$/u;

export const categoryKey = (name: string) => nameKey(name).replaceAll(/[^\p{L}\p{N}]+/gu, '');

export function categoryIds(themes: readonly ThemeName[]) {
  return new Map(themes.map((theme) => [categoryKey(theme.name), theme.id]));
}

export function chooseCategory(
  raw: string,
  existing: ReadonlyMap<string, string>,
  names: Names,
): CategoryChoice | null {
  const limits = names.policy.project_themes;
  const name = cleanName(raw);
  const key = categoryKey(name);
  if (key === categoryKey(limits.fallback)) return { kind: 'other' };
  const id = existing.get(key);
  if (id !== undefined) return { kind: 'theme', theme_id: id };
  const valid =
    PLAIN.test(name) &&
    words(name) <= limits.model_name_max_words &&
    Array.from(name).length <= limits.name_max_chars &&
    countedMatches(names.businesses, name).length === 0;
  return valid ? { kind: 'new', name } : null;
}

export function cleanAttribute(
  raw: string,
  policy: Pick<PerceptionPolicy, 'attribute_max_words' | 'attribute_max_chars'>,
): string | null {
  const attribute = cleanName(raw);
  if (!PLAIN.test(attribute)) return null;
  if (words(attribute) > policy.attribute_max_words) return null;
  return Array.from(attribute).length > policy.attribute_max_chars ? null : attribute;
}

async function projectThemes(db: Database, scope: { workspaceId: string; projectId: string }) {
  return db
    .selectFrom('project_themes')
    .select(['id', 'name', 'source'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .execute();
}

async function saveModelCategories(
  db: Database,
  input: {
    workspaceId: string;
    projectId: string;
    names: readonly string[];
    policy: Pick<PerceptionPolicy, 'project_themes'>;
  },
): Promise<ReadonlyMap<string, string>> {
  await lockThemes(db, input.projectId);
  const themes = await projectThemes(db, input);
  const known = categoryIds(themes);
  const room = Math.max(
    0,
    input.policy.project_themes.model_max - themes.filter((row) => row.source === 'model').length,
  );
  const fresh = [
    ...new Map(
      input.names
        .filter((name) => !known.has(categoryKey(name)))
        .map((name) => [categoryKey(name), name]),
    ).values(),
  ].slice(0, room);
  if (!fresh.length) return known;
  await saveModelThemes(db, input, fresh);
  return categoryIds(await projectThemes(db, input));
}

function newCategoryNames(aspects: readonly ExtractedAspect[]) {
  return aspects.flatMap(({ category }) => (category.kind === 'new' ? [category.name] : []));
}

function storedAspects(
  aspects: readonly ExtractedAspect[],
  ids: ReadonlyMap<string, string>,
): { aspects: VerifiedAspect[]; capped: number; removed: number } {
  let capped = 0;
  let removed = 0;
  const live = new Set(ids.values());
  const stored = aspects.map(({ category, ...aspect }): VerifiedAspect => {
    switch (category.kind) {
      case 'theme': {
        if (live.has(category.theme_id)) return { ...aspect, theme_id: category.theme_id };
        removed++;
        return { ...aspect, theme_id: null };
      }
      case 'other':
        return { ...aspect, theme_id: null };
      case 'new': {
        const id = ids.get(categoryKey(category.name)) ?? null;
        if (id === null) capped++;
        return { ...aspect, theme_id: id };
      }
      default: {
        const _exhaustive: never = category;
        return _exhaustive;
      }
    }
  });
  return { aspects: stored, capped, removed };
}

export async function categorised(
  db: Database,
  input: {
    workspaceId: string;
    projectId: string;
    entities: readonly EntitySentiment[];
    drops: Partial<Record<DropReason, number>>;
    policy: Pick<PerceptionPolicy, 'project_themes'>;
  },
) {
  const { entities } = input;
  const ids = entities.some((entity) => entity.aspects.length)
    ? await saveModelCategories(db, {
        ...input,
        names: entities.flatMap((entity) => newCategoryNames(entity.aspects)),
      })
    : new Map<string, string>();
  const stored = entities.map((entity) => ({ entity, ...storedAspects(entity.aspects, ids) }));
  const capped = stored.reduce((sum, row) => sum + row.capped, 0);
  const removed = stored.reduce((sum, row) => sum + row.removed, 0);
  return {
    stored,
    drops: {
      ...input.drops,
      ...(capped ? { category_limit: capped } : {}),
      ...(removed ? { category_removed: removed } : {}),
    },
  };
}
