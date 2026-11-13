/** A third-party page answers cite: a declaration records the publisher page, not an owned one. */
import { plainTarget } from './shared.ts';
import type { ActionTargetModule } from './kind.ts';

export const earnedPageTarget: ActionTargetModule<'earned_page'> = {
  ...plainTarget('earned_page'),
  async declarationTargets({ action }) {
    if (!action.target_url)
      return { resolved: false, reason: 'Implementation target is unresolved' };
    return { resolved: true, target_site_url_ids: [], target_external_url: action.target_url };
  },
};
