import { isOneOf } from '@/lib/utils';

export const TABLE_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export type TablePageSize = (typeof TABLE_PAGE_SIZE_OPTIONS)[number];

export const TABLE_DEFAULT_PAGE_SIZE: TablePageSize = TABLE_PAGE_SIZE_OPTIONS[0];

export function isTablePageSize(value: number): value is TablePageSize {
  return isOneOf(TABLE_PAGE_SIZE_OPTIONS, value);
}
