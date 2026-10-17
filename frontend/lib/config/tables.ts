/**
 * Cursor-table configuration (frontend config owner).
 *
 * The rows-per-page vocabulary the shared cursor-table footer offers. It
 * MIRRORS the backend's `PERFORMANCE_PAGE_SIZE_OPTIONS`, which validates the
 * requested size and rejects anything outside the set rather than silently
 * clamping it — a clamped size would page a different result set than the
 * cursor the client already holds was cut against.
 */
export const TABLE_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export type TablePageSize = (typeof TABLE_PAGE_SIZE_OPTIONS)[number];

/** The size a table starts on, and falls back to for an unknown stored value. */
export const TABLE_DEFAULT_PAGE_SIZE: TablePageSize = TABLE_PAGE_SIZE_OPTIONS[0];

export function isTablePageSize(value: number): value is TablePageSize {
  return (TABLE_PAGE_SIZE_OPTIONS as readonly number[]).includes(value);
}
