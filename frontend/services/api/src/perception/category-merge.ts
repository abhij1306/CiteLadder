import type { Database } from '../db/database.ts';
import { mergeThemes, type ThemeMerge } from '../projects/themes.ts';
import { moveAspectsTheme } from './executor.ts';

export function mergeCategories(db: Database, scope: ThemeMerge) {
  return mergeThemes(db, scope, async (trx) => {
    await moveAspectsTheme(trx, scope);
  });
}
