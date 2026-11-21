import { describe, expect, it } from 'vite-plus/test';

import { selectionPageState } from './selection-page';

const queries = (audits: { isLoading?: boolean; isError?: boolean }, hasRuns: boolean) =>
  ({ auditsQuery: { isLoading: false, isError: false, ...audits }, hasRuns }) as never;

describe('selectionPageState', () => {
  it.each([
    ['loading', queries({ isLoading: true }, false), 'loading'],
    ['a failed first read', queries({ isError: true }, false), 'error'],
    ['a failed refetch over cached runs keeps the data', queries({ isError: true }, true), null],
    ['no runs', queries({}, false), 'empty'],
    ['runs', queries({}, true), null],
  ])('%s', (_, input, expected) => {
    expect(selectionPageState(input)).toBe(expected);
  });
});
