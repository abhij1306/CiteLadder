/** Actions list responses as the API sends them. */

/** Every group counted, none holding an Action. */
const NO_GROUP_COUNTS = { fix_site: 0, own_pages: 0, earned: 0, products: 0 };

/** One page of the Actions list: the rows, no next page, and the given counts. */
export function actionsPage(
  items: readonly unknown[] = [],
  counts: Readonly<{
    status_counts?: Record<string, number>;
    group_counts?: Partial<typeof NO_GROUP_COUNTS>;
  }> = {},
) {
  return {
    items,
    next_cursor: null,
    status_counts: counts.status_counts ?? {},
    group_counts: { ...NO_GROUP_COUNTS, ...counts.group_counts },
  };
}
