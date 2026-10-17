/** Filter shape shared by every list-style query key. */
export type ListFilters = Readonly<
  Record<string, string | number | boolean | readonly string[] | null | undefined>
>;
