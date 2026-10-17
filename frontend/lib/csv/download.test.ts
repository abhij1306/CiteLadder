import { describe, expect, it } from 'vitest';

import { toCsvForTest } from './download';

/**
 * The export's job is to survive being opened.
 *
 * Two failures matter and neither is cosmetic: a cited page title containing a
 * comma or a quote must not shift every column after it, and a title beginning
 * with a formula trigger must not be evaluated when the file is opened in a
 * spreadsheet. Both are properties of the escaping, so they are asserted on the
 * text it produces rather than on a downloaded file.
 */
describe('toCsv', () => {
  it('quotes a value that would otherwise break the row', () => {
    const csv = toCsvForTest(['Domain', 'Title'], [['wise.com', 'Cards, fees and "limits"']]);
    expect(csv).toBe('Domain,Title\r\nwise.com,"Cards, fees and ""limits"""');
  });

  it('keeps a newline inside its own cell', () => {
    const csv = toCsvForTest(['Title'], [['Line one\nLine two']]);
    expect(csv).toBe('Title\r\n"Line one\nLine two"');
  });

  it('defuses a value a spreadsheet would treat as a formula', () => {
    const csv = toCsvForTest(['Title'], [['=1+1'], ['+SUM(A1)'], ['@cmd'], ['-5 tips']]);
    // Each gains a leading apostrophe, and the quoting follows from it.
    expect(csv.split('\r\n').slice(1)).toEqual(["'=1+1", "'+SUM(A1)", "'@cmd", "'-5 tips"]);
  });

  it('renders an absent value as an empty cell, never as "null"', () => {
    expect(toCsvForTest(['A', 'B'], [[null, undefined]])).toBe('A,B\r\n,');
  });
  it('neutralizes formula triggers following whitespace', () => {
    expect(toCsvForTest(['Title'], [['  =1+1'], ['\t@cmd']])).toBe("Title\r\n'  =1+1\r\n'\t@cmd");
  });
});
