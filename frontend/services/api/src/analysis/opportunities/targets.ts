/**
 * What an Opportunity is about. Producers emit a `TargetRef`; the persisted
 * `target_*` columns and the identity `target_key` derive here and nowhere
 * else, and Action grouping switches on the same union.
 */
import { policy } from '../../config.ts';

export type TargetRef =
  /** A tracked prompt; `theme` is the prompt's theme when the run recorded one. */
  | { kind: 'prompt'; prompt_id: string; theme: string | null }
  /** A prompt the run asked but no tracked prompt names any more. */
  | { kind: 'prompt_index'; audit_id: string; prompt_index: number; theme: string | null }
  /** An owned page a Site Health rule failed on. */
  | { kind: 'site_page'; url: string }
  /** One field of an owned page that changed between two crawls. */
  | { kind: 'site_change'; site_url_id: string; field: string; url: string }
  /** An owned page that should link to related pages. */
  | { kind: 'link_source'; site_url_id: string; url: string }
  /** A promoted Search Console signal on a page or a query. */
  | { kind: 'demand'; identity_hash: string; url: string | null; query: string | null }
  | { kind: 'product'; product_id: string }
  | { kind: 'category'; category_id: string }
  /** A third-party page answers cite, keyed by its url hash. */
  | { kind: 'earned_page'; url_hash: string; url: string; theme: string | null }
  /** A search competitors rank for; `url` is the owned page that covers it, if any. */
  | { kind: 'search_gap'; terms: string; keyword: string; url: string | null };

type TargetColumns = {
  target_key: string;
  target_prompt_id: string | null;
  target_url: string | null;
  target_theme: string | null;
};

/** The persisted target of an earned page, the key its Action is found by. */
export const earnedTargetKey = (urlHash: string) =>
  `${policy.opportunity.earned_actions.EARNED_PAGE_TARGET_PREFIX}${urlHash}`;

const columns = (
  target_key: string,
  values: Partial<Omit<TargetColumns, 'target_key'>> = {},
): TargetColumns => ({
  target_key,
  target_prompt_id: null,
  target_url: null,
  target_theme: null,
  ...values,
});

/** The persisted columns of a target; `target_key` is its identity across snapshots. */
export function targetColumns(target: TargetRef): TargetColumns {
  switch (target.kind) {
    case 'prompt':
      return columns(`prompt:${target.prompt_id}`, {
        target_prompt_id: target.prompt_id,
        target_theme: target.theme,
      });
    case 'prompt_index':
      return columns(`prompt-index:${target.audit_id}:${target.prompt_index}`, {
        target_theme: target.theme,
      });
    case 'site_page':
      return columns(`url:${target.url}`, { target_url: target.url });
    case 'site_change':
      return columns(`site-change:${target.site_url_id}:${target.field}`, {
        target_url: target.url,
      });
    case 'link_source':
      return columns(`internal-links:${target.site_url_id}`, { target_url: target.url });
    case 'demand':
      return columns(`demand:${target.identity_hash}`, {
        target_url: target.url,
        target_theme: target.query,
      });
    case 'product':
      return columns(`product:${target.product_id}`);
    case 'category':
      return columns(`category:${target.category_id}`);
    case 'earned_page':
      return columns(earnedTargetKey(target.url_hash), {
        target_url: target.url,
        target_theme: target.theme,
      });
    case 'search_gap':
      return columns(`search-gap:${target.terms}`, {
        target_url: target.url,
        target_theme: target.keyword,
      });
    default: {
      const unknownTarget: never = target;
      throw new Error(`Unknown Opportunity target: ${JSON.stringify(unknownTarget)}`);
    }
  }
}

/** A hit's identity key: (rule, target) is one Opportunity across snapshots. */
export const targetKey = (target: TargetRef) => targetColumns(target).target_key;
