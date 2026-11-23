import { policy } from '../../config.ts';

export type TargetRef =
  | { kind: 'prompt'; prompt_id: string; theme: string | null }
  | { kind: 'prompt_index'; audit_id: string; prompt_index: number; theme: string | null }
  | { kind: 'site_page'; url: string }
  | { kind: 'issue_family'; rule_id: string; label: string }
  | { kind: 'site_change'; site_url_id: string; field: string; url: string }
  | { kind: 'link_source'; site_url_id: string; url: string }
  | { kind: 'demand'; identity_hash: string; url: string | null; query: string | null }
  | { kind: 'product'; product_id: string }
  | { kind: 'category'; category_id: string }
  | { kind: 'earned_page'; url_hash: string; url: string; theme: string | null }
  | { kind: 'search_gap'; terms: string; keyword: string; url: string | null }
  | { kind: 'planned_page'; key: string; label: string };

type TargetColumns = {
  target_key: string;
  target_prompt_id: string | null;
  target_url: string | null;
  target_theme: string | null;
};

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
    case 'issue_family':
      return columns(`issue-family:${target.rule_id}`, { target_theme: target.label });
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
    case 'planned_page':
      return columns(target.key, { target_theme: target.label });
    default: {
      const unknownTarget: never = target;
      throw new Error(`Unknown Opportunity target: ${JSON.stringify(unknownTarget)}`);
    }
  }
}

export const targetKey = (target: TargetRef) => targetColumns(target).target_key;
