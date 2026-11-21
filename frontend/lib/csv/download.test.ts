import { describe, expect, it } from 'vitest';

import { toCsv } from './download';

describe('toCsv', () => {
  it('quotes a value that would otherwise break the row', () => {
    const csv = toCsv(['Domain', 'Title'], [['wise.com', 'Cards, fees and "limits"']]);
    expect(csv).toBe('Domain,Title\r\nwise.com,"Cards, fees and ""limits"""');
  });

  it('keeps a newline inside its own cell', () => {
    const csv = toCsv(['Title'], [['Line one\nLine two']]);
    expect(csv).toBe('Title\r\n"Line one\nLine two"');
  });

  it('defuses a value a spreadsheet would treat as a formula', () => {
    const csv = toCsv(['Title'], [['=1+1'], ['+SUM(A1)'], ['@cmd'], ['-5 tips'], [-12.5]]);
    expect(csv.split('\r\n').slice(1)).toEqual([
      "'=1+1",
      "'+SUM(A1)",
      "'@cmd",
      "'-5 tips",
      '-12.5',
    ]);
  });

  it('renders an absent value as an empty cell, never as "null"', () => {
    expect(toCsv(['A', 'B'], [[null, undefined]])).toBe('A,B\r\n,');
  });
  it('neutralizes formula triggers following whitespace', () => {
    expect(toCsv(['Title'], [['  =1+1'], ['\t@cmd']])).toBe("Title\r\n'  =1+1\r\n'\t@cmd");
  });
});
